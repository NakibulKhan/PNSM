import { http } from "./http";

/**
 * PNSM check-in API client.
 * Request/response shapes follow api-contract.md, which remains the source of
 * truth for the wire format (Person 3 owns it).
 */

export const MOCK_BACKEND = true; // flip to false once Person 3's routes are live

/* ===========================================================================
 * UNRESOLVED CONFLICT — 2FA PIN TRANSMISSION FORMAT. DO NOT "FIX" SILENTLY.
 * ===========================================================================
 * Three sources disagree about what this client should send:
 *
 *   1. Blueprint, Quadrant I (Person 1, this module):
 *        "...a hashed representation of the user's two-factor
 *         authentication (2FA) PIN."
 *
 *   2. Blueprint, Quadrant III (Person 3, the backend that receives it):
 *        "...cryptographically comparing the supplied 2FA PIN against a
 *         stored bcrypt hash."
 *
 *   3. api-contract.md (the ratified interface contract):
 *        `pin` | string (4 digits) | "The PIN as entered..."
 *
 * (1) and (2) are mutually exclusive as written. bcrypt.compare(plaintext,
 * storedHash) requires the PLAINTEXT: bcrypt embeds a per-hash random salt,
 * so the server cannot reproduce a client-side digest to compare against a
 * stored bcrypt hash. If this client sent SHA-256(pin), Person 3's documented
 * bcrypt comparison would fail for every single employee, every time.
 *
 * Separately, client-side hashing of a 4-digit PIN provides no meaningful
 * security benefit: the keyspace is 10,000 values, so an unsalted digest is
 * exhaustively reversible in microseconds. It also converts the digest into a
 * password-equivalent — an attacker who captures it can replay it directly —
 * while the transport is already protected by the TLS 1.2+ requirement in the
 * NFRs and Quadrant IV.
 *
 * RESOLUTION TAKEN: send the PIN as the contract specifies (option 3), which
 * is also the only option compatible with Quadrant III's bcrypt comparison.
 * The alternative is implemented behind the flag below but left OFF, so the
 * team can switch in one line IF Person 3 confirms they pre-hash before
 * bcrypt (i.e. store bcrypt(sha256(pin)) and compare against sha256(pin)).
 *
 * ACTION REQUIRED: Person 3 to confirm. Until then this stays as-is.
 * =========================================================================== */
export const CLIENT_SIDE_PIN_PREHASH = false;

/**
 * SHA-256 via WebCrypto, available in the Capacitor WebView on both platforms.
 * Only used if CLIENT_SIDE_PIN_PREHASH is enabled — see the block above.
 */
export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function resolvePinField(pin) {
  return CLIENT_SIDE_PIN_PREHASH ? sha256Hex(pin) : pin;
}

/**
 * Builds the multipart body for POST /api/attendance/checkin.
 * Field names match api-contract.md's request table exactly.
 *
 * NOTE on `geofence_id`: the contract's request table omits it while its
 * "Note on IDs" section references it. That inconsistency is still open with
 * Person 3, so the field is sent (per the note) but conditionally, and this
 * comment stays until it is resolved.
 */
export async function buildCheckinFormData(payload) {
  const form = new FormData();
  form.append("employee_id", payload.employee_id);
  form.append("check_type", payload.check_type);
  form.append("timestamp", payload.timestamp);
  form.append("gps.lat", String(payload.gps.lat));
  form.append("gps.lng", String(payload.gps.lng));
  form.append("gps.simulated", String(payload.gps.simulated));
  form.append("mock_location_flag", String(payload.mock_location_flag));
  form.append("liveness_passed", String(payload.liveness_passed));
  form.append("pin", await resolvePinField(payload.pin));
  if (payload.geofence_id) form.append("geofence_id", payload.geofence_id);
  if (payload.selfieBlob) {
    form.append("selfie", payload.selfieBlob, "selfie.jpg");
  }
  return form;
}

/**
 * POST /api/attendance/checkin
 * Resolves to a contract-shaped response, or a client-synthesised
 * {status:'error'} for transport failures the server never got to answer.
 */
export async function submitCheckin(payload) {
  if (MOCK_BACKEND) return mockSubmitCheckin(payload);

  let res;
  try {
    const form = await buildCheckinFormData(payload);
    res = await http.post("/api/attendance/checkin", form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  } catch (err) {
    // Axios rejects on non-2xx as well as on transport failure.
    const status = err.response?.status;
    const body = err.response?.data ?? {};

    if (!err.response) {
      return { status: "error", reason: "network_error", face_match_score: null };
    }
    // Contract: 422 -> outside_geofence | mock_location_detected |
    // liveness_failed ; 401 -> pin_mismatch
    if ((status === 422 || status === 401) && body.reason) {
      return { status: "rejected", reason: body.reason, face_match_score: null };
    }
    if (status >= 500) {
      return { status: "error", reason: "server_error", face_match_score: null };
    }
    return { status: "error", reason: "invalid_request", face_match_score: null };
  }

  return res.data;
}

/* ------------------------------------------------------------ mock backend */

const MOCK_PIN = "4821";

function mockSubmitCheckin(payload) {
  return new Promise((resolve) => {
    setTimeout(async () => {
      // The mock verifies the PIN itself, mirroring what a real backend does.
      // The client never decides PIN validity — there is deliberately no
      // `pin_verified` boolean anywhere in this codebase.
      const expected = await resolvePinField(MOCK_PIN);
      if (payload.pin !== undefined) {
        const supplied = await resolvePinField(payload.pin);
        if (supplied !== expected) {
          resolve({ status: "rejected", reason: "pin_mismatch", face_match_score: null });
          return;
        }
      }
      if (payload.mock_location_flag) {
        resolve({ status: "rejected", reason: "mock_location_detected", face_match_score: null });
        return;
      }
      if (payload.liveness_passed === false) {
        resolve({ status: "rejected", reason: "liveness_failed", face_match_score: null });
        return;
      }

      const roll = Math.random();
      let score;
      let status;
      if (roll < 0.75) {
        score = Math.round(85 + Math.random() * 14);
        status = "approved";
      } else if (roll < 0.92) {
        score = Math.round(70 + Math.random() * 14);
        status = "flagged";
      } else {
        score = Math.round(40 + Math.random() * 25);
        status = "rejected";
      }
      resolve({
        attendance_log_id: `mock-${Date.now()}`,
        status,
        face_match_score: score,
        reason: status === "approved" ? null : "low_face_match",
        server_timestamp: new Date().toISOString(),
      });
    }, 900);
  });
}

/* ------------------------------------------------- response interpretation */

/**
 * Single source of truth mapping every documented contract reason — plus the
 * client-only transport categories the server can never report — onto what
 * the UI renders. `kind` drives the three-way visual split.
 */
export function interpretCheckinResponse(res) {
  if (res?.status === "approved") {
    return { kind: "success", title: "Checked in", message: "Your attendance has been recorded." };
  }
  if (res?.status === "flagged") {
    return {
      kind: "review",
      title: "Sent for HR review",
      message: "Recorded, but the face match was below threshold — HR will review it manually.",
    };
  }
  if (res?.status === "rejected") {
    switch (res.reason) {
      case "outside_geofence":
        return {
          kind: "rejected",
          title: "Outside office geofence",
          message: "You're outside your office's geofence — move closer and retry.",
        };
      case "mock_location_detected":
        return {
          kind: "rejected",
          title: "Mock location detected",
          message: "Check-in blocked — simulated location detected. HR has been notified.",
        };
      case "liveness_failed":
        return {
          kind: "rejected",
          title: "Liveness check failed",
          message: "Liveness check failed — try again in better lighting.",
        };
      case "pin_mismatch":
        return { kind: "rejected", title: "Incorrect PIN", message: "Incorrect PIN." };
      case "low_face_match":
      default:
        return {
          kind: "rejected",
          title: "Check-in rejected",
          message: "Your face didn't match our records closely enough. Try again in better lighting.",
        };
    }
  }
  switch (res?.reason) {
    case "network_error":
      return {
        kind: "error",
        title: "Couldn't reach the server",
        message: "Check your connection and try again. Your check-in was not recorded.",
      };
    case "invalid_request":
      return {
        kind: "error",
        title: "Request couldn't be processed",
        message: "Something about this request wasn't valid. Please try again.",
      };
    default:
      return {
        kind: "error",
        title: "Server error",
        message: "Something went wrong on our end. Please try again shortly.",
      };
  }
}

/* ------------------------------------------------------- anomaly reporting */

/**
 * Fire-and-forget anomaly dispatch required by the blueprint: when spoofing is
 * detected the client rejects locally to preserve server bandwidth, but still
 * reports the attempt for administrative review.
 */
export async function reportSpoofingAnomaly(details) {
  if (MOCK_BACKEND) return { reported: true, mock: true };
  try {
    await http.post("/api/attendance/anomaly", {
      type: "mock_location_detected",
      ...details,
    });
    return { reported: true };
  } catch {
    // Never let a failed anomaly report block or crash the check-in UI.
    return { reported: false };
  }
}
