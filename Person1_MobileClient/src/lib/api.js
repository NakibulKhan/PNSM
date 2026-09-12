import axios from "axios";
import { http, API_BASE_URL, setAccessToken, setRefreshToken } from "./http";

/**
 * PNSM mobile API client.
 * Request/response shapes follow the real backend contract Person 3 built
 * (PNSM_Khan_Edit's Person3_BackendAPI/src/validation/mobileSchemas.ts) —
 * that codebase is the source of truth for the wire format now that it
 * exists, superseding the earlier api-contract.md draft this file was
 * originally written against.
 */

// Defaults to the real backend now that it exists (ROADMAP.md Phase 3).
// Set VITE_MOCK_BACKEND=true to fall back to the deterministic mock below
// for offline UI work.
export const MOCK_BACKEND = import.meta.env?.VITE_MOCK_BACKEND === "true";

/* ===========================================================================
 * 2FA PIN TRANSMISSION FORMAT — RESOLVED. See PNSM_Khan_Edit/DECISIONS.md,
 * the "PIN transmission" entry: raw PIN over TLS, hashed server-side via
 * Person 4's bcrypt-hmac-sha256-pepper scheme. Client-side hashing would be
 * security theater against a bcrypt-compare backend (bcrypt needs the
 * plaintext) and provides no real protection for a 4-digit keyspace anyway.
 * The `sha256Hex` client-side pre-hash helper this decision made unnecessary
 * (and this file's README once still documented as `CLIENT_SIDE_PIN_PREHASH`)
 * was deleted here — no caller ever sent a hashed PIN (L1/L3, master audit).
 * =========================================================================== */

/* --------------------------------------------------------------------- auth */

const MOCK_EMPLOYEE_CODE = "EMP-2431";
const MOCK_PASSWORD = "demo1234";

/** Self-consistent offline demo profile, used only when VITE_MOCK_BACKEND=true. */
function mockProfile() {
  const now = Date.now();
  return {
    employee: {
      _id: "mock-emp-2431",
      name: "Mehnaz Afrida Chowdhury",
      employee_code: MOCK_EMPLOYEE_CODE,
      email: "mehnaz@pnsm.example.com",
      department: "Field Operations",
      reference_photo_url: null,
    },
    office: { _id: "mock-office-hq", office_name: "PNSM HQ — Bashundhara, Dhaka", address: "" },
    geofence: { _id: "mock-geofence-hq", lat: 23.8151, lng: 90.4257, radius_meters: 150 },
    shift: { start_time: "09:00", end_time: "18:00", days_of_week: [0, 1, 2, 3, 4], days_of_week_label: "Sun-Thu" },
    recent_logs: [
      { _id: "mock-log-1", check_type: "check_in", timestamp: new Date(now - 86400000).toISOString(), status: "approved", face_match_score: 96 },
      { _id: "mock-log-2", check_type: "check_in", timestamp: new Date(now - 172800000).toISOString(), status: "flagged", face_match_score: 78 },
    ],
  };
}

/**
 * POST /api/mobile/auth/login — DECISIONS.md N3. Password only; the PIN is
 * verified once per check-in via Person 4's service, not at login.
 */
export async function loginMobile(employeeCode, password) {
  if (MOCK_BACKEND) {
    if (employeeCode !== MOCK_EMPLOYEE_CODE || password !== MOCK_PASSWORD) {
      const err = new Error("Incorrect employee ID or password.");
      err.response = { status: 401, data: { status: "rejected", reason: "invalid_credentials" } };
      throw err;
    }
    setAccessToken("mock-access-token");
    return mockProfile().employee;
  }
  const res = await http.post("/api/mobile/auth/login", {
    employee_code: employeeCode,
    password,
  });
  setAccessToken(res.data.access_token);
  // Keep the refresh token too (memory only). The server's refresh cookie is
  // pinned to path=/api/auth and so can never reach /api/mobile/auth/refresh —
  // this body copy is the only thing that keeps a session alive past 15
  // minutes. See the header comment in lib/http.js.
  setRefreshToken(res.data.refresh_token);
  return res.data.user;
}

export async function logoutMobile() {
  if (MOCK_BACKEND) return;
  try {
    await http.post("/api/mobile/auth/logout");
  } catch {
    /* best-effort — clearing the local token is what actually matters */
  }
}

/** GET /api/mobile/me — DECISIONS.md N4. Profile + assigned office/geofence/shift/history. */
export async function fetchMobileProfile() {
  if (MOCK_BACKEND) return mockProfile();
  const res = await http.get("/api/mobile/me");
  return res.data;
}

/* ----------------------------------------------------------- selfie upload */

/**
 * DECISIONS.md N2: the selfie is never sent through the backend as a file.
 * Ask for a presigned URL, PUT the compressed bytes straight to the bucket,
 * then reference the object by key in the check-in payload.
 *
 * @param {Blob} blob
 * @param {'checkin'|'reference'} purpose
 * @returns {Promise<string>} the object_key to send with the check-in
 */
export async function uploadSelfie(blob, purpose = "checkin") {
  if (MOCK_BACKEND) return `mock/${purpose}/${Date.now()}.jpg`;

  const presign = await http.post("/api/mobile/uploads/presign", {
    purpose,
    content_type: blob.type || "image/jpeg",
    content_length: blob.size,
  });
  const { upload_url, headers, object_key } = presign.data;

  // Deliberately a bare axios call, not `http`: a presigned URL carries its
  // own signature-based authorization. Sending this backend's bearer token
  // or cookies to the storage bucket is unnecessary and, for a third-party
  // bucket origin, actively wrong.
  await axios.put(upload_url, blob, { headers });

  return object_key;
}

/* -------------------------------------------------------------- check-in */

/**
 * Builds the JSON body for POST /api/mobile/attendance/checkin.
 * Field names match Person 3's mobileCheckinSchema exactly. `employee_id`
 * is deliberately absent — identity comes from the bearer token, not the
 * body.
 */
export function buildCheckinPayload(payload) {
  return {
    check_type: payload.check_type,
    timestamp: payload.timestamp,
    captured_at: payload.captured_at,
    gps: { lat: payload.gps.lat, lng: payload.gps.lng },
    geofence_id: payload.geofence_id,
    pin: payload.pin,
    liveness_frames: payload.liveness_frames,
    object_key: payload.object_key,
    device: payload.device,
  };
}

/**
 * POST /api/mobile/attendance/checkin
 * Resolves to a contract-shaped response, or a client-synthesised
 * {status:'error'} for transport failures the server never got to answer.
 */
export async function submitCheckin(payload) {
  if (MOCK_BACKEND) return mockSubmitCheckin(payload);

  let res;
  try {
    const body = buildCheckinPayload(payload);
    res = await http.post("/api/mobile/attendance/checkin", body);
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data ?? {};

    if (!err.response) {
      return { status: "error", reason: "network_error", face_match_score: null };
    }
    // The backend's mobile error envelope already carries {status, reason,
    // face_match_score} for every documented rejection (bare body, ADR-1) —
    // pass it through directly rather than re-deriving it.
    if (body.status === "rejected" || body.status === "error") {
      return body;
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

async function resolvePinField(pin) {
  return pin; // the mock verifies the PIN itself, matching what a real backend does
}

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
      if (payload.device?.is_mock_location) {
        resolve({ status: "rejected", reason: "mock_location_detected", face_match_score: null });
        return;
      }
      // The mock has no real camera frames to run correlation on, so it
      // simulates the server's fail-closed behavior: too few captured frames
      // (camera denied, or the challenge never completed) is treated exactly
      // like a real backend would treat a malformed/insufficient request.
      if (!Array.isArray(payload.liveness_frames) || payload.liveness_frames.length < 2) {
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
      case "pin_locked":
        return {
          kind: "rejected",
          title: "PIN temporarily locked",
          message: "Too many incorrect attempts. Try again later or contact HR.",
        };
      case "no_reference_embedding":
      case "profile_needs_attention":
        return {
          kind: "rejected",
          title: "Profile incomplete",
          message: "Your profile needs attention before you can check in. Contact HR.",
        };
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
    await http.post("/api/mobile/attendance/anomaly", {
      lat: details.lat,
      lng: details.lng,
      platform: details.platform,
      indicated_apps: details.indicated_apps,
      detection_confidence: details.detection_confidence,
      timestamp: details.timestamp,
    });
    return { reported: true };
  } catch {
    // Never let a failed anomaly report block or crash the check-in UI.
    return { reported: false };
  }
}

export { API_BASE_URL };
