import { captureSelfie, getCurrentPosition, ensureCameraPermission, ensureLocationPermission } from "./hardware";
import { checkMockLocation } from "./mockLocation";
import { compressSelfie, isUnderSizeLimit, MAX_SELFIE_BYTES } from "./compression";
import { submitCheckin, interpretCheckinResponse, reportSpoofingAnomaly } from "./api";
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
 *   -> compress -> size gate -> submit
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
  "submitting",
];

/**
 * @param {object} opts
 * @param {object} opts.office          - active office geofence
 * @param {string} opts.employeeId
 * @param {string} opts.pin             - as entered; never validated locally
 * @param {(step:string)=>void} [opts.onStep]
 * @param {()=>Promise<boolean>} opts.runLiveness - resolves true if confirmed
 * @param {object} [opts.deps]          - injectable seams for testing
 * @returns {Promise<{outcome:object, response:object|null, meta:object}>}
 */
export async function runCheckin({
  office,
  employeeId,
  pin,
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
  if (spoof.isMock) {
    // Reject locally to preserve server bandwidth, but still dispatch the
    // anomaly flag for administrative review, per the blueprint.
    await reportAnomaly({
      employee_id: employeeId,
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
  } catch (err) {
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
  const livenessPassed = runLiveness ? await runLiveness() : true;
  meta.livenessPassed = livenessPassed;

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

  /* -------------------------------------------------------------- submit */
  onStep("submitting");
  const payload = {
    employee_id: employeeId,
    check_type: "check_in",
    timestamp: new Date().toISOString(),
    gps: { lat: position.lat, lng: position.lng, simulated: false },
    geofence_id: office.key,
    liveness_passed: livenessPassed,
    pin, // sent as entered — verification is the server's job
    mock_location_flag: spoof.isMock,
    selfieBlob: compressed.blob,
  };

  const response = await submit(payload);
  return { outcome: interpretCheckinResponse(response), response, meta };
}
