import { captureSelfie, getCurrentPosition, ensureCameraPermission, ensureLocationPermission } from "./hardware";
import { checkMockLocation } from "./mockLocation";
import { compressSelfie, isUnderSizeLimit, MAX_SELFIE_BYTES } from "./compression";
import { submitCheckin, interpretCheckinResponse, reportSpoofingAnomaly, uploadSelfie } from "./api";
import { getDeviceInfo } from "./deviceInfo";
import { isInsideGeofence, distanceMeters } from "./geofence";

/**
 * Orchestrates the end-to-end check-in sequence.
 *
 * Extracted out of the React component on purpose: the sequence has a lot of
 * ordered failure branches, and having it as a plain async function means it
 * can be unit-tested by injecting fakes, instead of only being exercisable by
 * driving a real camera on a real phone.
 *
 * Ordering is deliberate and mirrors server-side precedence:
 *   permissions -> GPS fix -> geofence -> spoofing -> capture -> liveness
 *   -> compress -> size gate -> upload -> submit
 * Cheap local rejections come first so we never burn the employee's mobile
 * data uploading a selfie that was going to be refused anyway.
 */

export const CHECKIN_STEPS = [
  "permissions",
  "locating",
  "geofence",
  "antispoof",
  "capture",
  "liveness",
  "compressing",
  "uploading",
  "submitting",
];

/**
 * @param {object} opts
 * @param {object} opts.office          - active office/geofence
 *   (office.name, office.lat, office.lng, office.radiusMeters, office.geofenceId)
 * @param {string} opts.employeeId
 * @param {string} opts.pin             - as entered; never validated locally
 * @param {(step:string)=>void} [opts.onStep]
 * @param {()=>Promise<Array<{color:string,image:{kind:'base64',value:string}}>>} opts.runLiveness
 *   - captures the active-illumination challenge frames (Item 3); the AI
 *     service is the authority on pass/fail, never this client
 * @param {object} [opts.deps]          - injectable seams for testing
 * @returns {Promise<{outcome:object, response:object|null, meta:object}>}
 */
export async function runCheckin({
  office,
  employeeId,
  pin,
  checkType = "check_in",
  onStep = () => {},
  runLiveness,
  deps = {},
}) {
  const {
    ensureCameraPermission: camPerm = ensureCameraPermission,
    ensureLocationPermission: locPerm = ensureLocationPermission,
    getCurrentPosition: getPos = getCurrentPosition,
    checkMockLocation: checkMock = checkMockLocation,
    captureSelfie: capture = captureSelfie,
    compressSelfie: compress = compressSelfie,
    uploadSelfie: upload = uploadSelfie,
    getDeviceInfo: getDevice = getDeviceInfo,
    submitCheckin: submit = submitCheckin,
    reportSpoofingAnomaly: reportAnomaly = reportSpoofingAnomaly,
  } = deps;

  const meta = {};

  /* ---------------------------------------------------------- permissions */
  onStep("permissions");
  const cam = await camPerm();
  if (!cam.granted) {
    return {
      outcome: {
        kind: "blocked",
        title: "Camera access required",
        message: "PNSM needs your camera to verify your identity.",
        canAskAgain: cam.canAskAgain,
      },
      response: null,
      meta,
    };
  }
  const loc = await locPerm();
  if (!loc.granted) {
    return {
      outcome: {
        kind: "blocked",
        title: "Location access required",
        message: `PNSM needs your location to confirm you're at ${office.name}.`,
        canAskAgain: loc.canAskAgain,
      },
      response: null,
      meta,
    };
  }

  /* ------------------------------------------------------------- GPS fix */
  onStep("locating");
  let position;
  try {
    position = await getPos({ timeout: 12000 });
  } catch {
    return {
      outcome: {
        kind: "error",
        title: "Couldn't get a GPS fix",
        message: "Move somewhere with a clearer view of the sky and try again.",
      },
      response: null,
      meta,
    };
  }
  meta.position = position;

  /* --------------------------------------------------- geofence pre-check */
  onStep("geofence");
  const metres = distanceMeters(position.lat, position.lng, office.lat, office.lng);
  meta.distanceMeters = metres;
  if (!isInsideGeofence(position.lat, position.lng, office)) {
    return {
      outcome: {
        kind: "rejected",
        title: "Outside office geofence",
        message: `You're about ${Math.round(metres)}m from ${office.name}. Move within ${office.radiusMeters}m and try again.`,
      },
      response: null,
      meta,
    };
  }

  /* ------------------------------------------------------- anti-spoofing */
  onStep("antispoof");
  const spoof = await checkMock();
  meta.spoof = spoof;
  const device = await getDevice();
  meta.device = device;

  if (spoof.isMock) {
    // Reject locally to preserve server bandwidth, but still dispatch the
    // anomaly flag for administrative review, per the blueprint.
    await reportAnomaly({
      lat: position.lat,
      lng: position.lng,
      platform: spoof.platform,
      indicated_apps: spoof.indicatedApps,
      detection_confidence: spoof.confidence,
      timestamp: new Date().toISOString(),
    });
    return {
      outcome: {
        kind: "rejected",
        title: "Mock location detected",
        message:
          "Check-in blocked because your device reported a simulated GPS location. This attempt has been reported to HR.",
      },
      response: null,
      meta,
    };
  }

  /* ------------------------------------------------------------- capture */
  onStep("capture");
  let dataUrl;
  try {
    dataUrl = await capture();
  } catch {
    // User cancelled the camera sheet is the common case here.
    return {
      outcome: {
        kind: "cancelled",
        title: "Check-in cancelled",
        message: "No photo was captured.",
      },
      response: null,
      meta,
    };
  }
  if (!dataUrl) {
    return {
      outcome: { kind: "cancelled", title: "Check-in cancelled", message: "No photo was captured." },
      response: null,
      meta,
    };
  }

  /* ------------------------------------------------------------ liveness */
  onStep("liveness");
  // Deliberately forwarded to the real backend as captured, including an
  // empty/short array — the server is the sole authority on pass/fail (see
  // Person3_BackendAPI/src/services/attendanceService.ts's own early
  // liveness_frames.length check, mirroring this exact architectural rule:
  // the client never invents a local pass/fail boolean, camera-denied
  // included). See __tests__/checkinFlow.test.js's own "rather than
  // deciding pass/fail locally" test for why this must stay a straight
  // forward, not a local short-circuit.
  const livenessFrames = runLiveness ? await runLiveness() : [];
  meta.livenessFrames = livenessFrames;

  /* ---------------------------------------------------------- compression */
  onStep("compressing");
  const compressed = await compress(dataUrl);
  meta.compression = {
    sizeBytes: compressed.sizeBytes,
    quality: compressed.quality,
    passes: compressed.passes,
    width: compressed.width,
    height: compressed.height,
  };

  // Hard gate. Never transmit an oversized payload.
  if (!isUnderSizeLimit(compressed.sizeBytes)) {
    return {
      outcome: {
        kind: "error",
        title: "Selfie too large to send",
        message: `We couldn't compress your photo under ${Math.round(MAX_SELFIE_BYTES / 1024)}KB. Try again in better lighting.`,
      },
      response: null,
      meta,
    };
  }

  /* ---------------------------------------------------- upload (DECISIONS.md N2) */
  onStep("uploading");
  const capturedAt = new Date().toISOString();
  let objectKey;
  try {
    objectKey = await upload(compressed.blob, "checkin");
  } catch {
    return {
      outcome: {
        kind: "error",
        title: "Couldn't upload your photo",
        message: "Check your connection and try again. Your check-in was not recorded.",
      },
      response: null,
      meta,
    };
  }
  meta.objectKey = objectKey;

  /* -------------------------------------------------------------- submit */
  onStep("submitting");
  const payload = {
    check_type: checkType,
    timestamp: new Date().toISOString(),
    captured_at: capturedAt,
    gps: { lat: position.lat, lng: position.lng },
    geofence_id: office.geofenceId,
    liveness_frames: livenessFrames,
    pin, // sent as entered — verification is the server's job
    object_key: objectKey,
    device: {
      platform: device.platform,
      os_version: device.os_version,
      app_version: device.app_version,
      is_mock_location: spoof.isMock,
      is_emulator: device.is_emulator,
      is_rooted: device.is_rooted,
    },
  };

  const response = await submit(payload);
  return { outcome: interpretCheckinResponse(response), response, meta };
}
