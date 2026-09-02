import { describe, it, expect, vi } from "vitest";
import { runCheckin } from "../src/lib/checkinService";
import { interpretCheckinResponse } from "../src/lib/api";
import { OFFICES } from "../src/lib/geofence";

const office = OFFICES.hq;

/** Builds a full set of passing fakes; individual tests override one at a time. */
function makeDeps(overrides = {}) {
  return {
    ensureCameraPermission: vi.fn(async () => ({ granted: true, canAskAgain: true })),
    ensureLocationPermission: vi.fn(async () => ({ granted: true, canAskAgain: true })),
    getCurrentPosition: vi.fn(async () => ({
      lat: office.lat,
      lng: office.lng,
      accuracy: 8,
      timestamp: Date.now(),
    })),
    checkMockLocation: vi.fn(async () => ({
      isMock: false,
      confidence: "reliable",
      platform: "android",
      indicatedApps: [],
      messages: [],
    })),
    captureSelfie: vi.fn(async () => "data:image/jpeg;base64,AAAA"),
    compressSelfie: vi.fn(async () => ({
      blob: new Blob(["x"], { type: "image/jpeg" }),
      sizeBytes: 120 * 1024,
      width: 900,
      height: 675,
      quality: 0.8,
      passes: 1,
      underLimit: true,
    })),
    submitCheckin: vi.fn(async () => ({
      attendance_log_id: "log-1",
      status: "approved",
      face_match_score: 96,
      reason: null,
      server_timestamp: new Date().toISOString(),
    })),
    reportSpoofingAnomaly: vi.fn(async () => ({ reported: true })),
    ...overrides,
  };
}

function run(deps, opts = {}) {
  return runCheckin({
    office,
    employeeId: "EMP-2431",
    pin: "4821",
    runLiveness: async () => true,
    deps,
    ...opts,
  });
}

describe("PIN handling — must never be verified or transformed on the client", () => {
  it("sends the PIN as entered, and sends NO pin_verified field", async () => {
    const deps = makeDeps();
    await run(deps);
    const payload = deps.submitCheckin.mock.calls[0][0];
    expect(payload.pin).toBe("4821");
    expect(payload).not.toHaveProperty("pin_verified");
  });

  it("submits an incorrect PIN to the backend rather than short-circuiting locally", async () => {
    // The client must not know or decide whether a PIN is right.
    const deps = makeDeps({
      submitCheckin: vi.fn(async () => ({
        status: "rejected",
        reason: "pin_mismatch",
        face_match_score: null,
      })),
    });
    const { outcome } = await run(deps, { pin: "0000" });
    expect(deps.submitCheckin).toHaveBeenCalledTimes(1);
    expect(deps.submitCheckin.mock.calls[0][0].pin).toBe("0000");
    expect(outcome.kind).toBe("rejected");
    expect(outcome.title).toBe("Incorrect PIN");
  });
});

describe("payload conforms to api-contract.md", () => {
  it("includes every required contract field with the right shape", async () => {
    const deps = makeDeps();
    await run(deps);
    const p = deps.submitCheckin.mock.calls[0][0];

    expect(p.employee_id).toBe("EMP-2431");
    expect(p.check_type).toBe("check_in");
    expect(typeof p.timestamp).toBe("string");
    expect(new Date(p.timestamp).toString()).not.toBe("Invalid Date");
    expect(typeof p.gps.lat).toBe("number");
    expect(typeof p.gps.lng).toBe("number");
    expect(typeof p.gps.simulated).toBe("boolean");
    expect(typeof p.mock_location_flag).toBe("boolean");
    expect(typeof p.liveness_passed).toBe("boolean");
    expect(typeof p.pin).toBe("string");
    expect(p.selfieBlob).toBeInstanceOf(Blob);
  });
});

describe("anti-spoofing", () => {
  it("rejects locally, does NOT call the backend, and reports the anomaly", async () => {
    const deps = makeDeps({
      checkMockLocation: vi.fn(async () => ({
        isMock: true,
        confidence: "reliable",
        platform: "android",
        indicatedApps: ["com.lexa.fakegps"],
        messages: [],
      })),
    });
    const { outcome } = await run(deps);

    expect(outcome.kind).toBe("rejected");
    expect(outcome.title).toBe("Mock location detected");
    // Bandwidth preservation requirement from the blueprint.
    expect(deps.submitCheckin).not.toHaveBeenCalled();
    // ...but the attempt is still surfaced to HR.
    expect(deps.reportSpoofingAnomaly).toHaveBeenCalledTimes(1);
    expect(deps.reportSpoofingAnomaly.mock.calls[0][0].indicated_apps).toContain("com.lexa.fakegps");
  });

  it("fails closed: a plugin error is treated as suspicious, not as clean", async () => {
    const deps = makeDeps({
      checkMockLocation: vi.fn(async () => ({
        isMock: true, // mockLocation.js returns true when the check cannot run
        confidence: "unavailable",
        platform: "ios",
        indicatedApps: [],
        messages: ["Mock-location check could not run: bridge unavailable"],
      })),
    });
    const { outcome } = await run(deps);
    expect(outcome.kind).toBe("rejected");
    expect(deps.submitCheckin).not.toHaveBeenCalled();
  });
});

describe("200KB image-size gate", () => {
  it("blocks submission when compression cannot get under the cap", async () => {
    const deps = makeDeps({
      compressSelfie: vi.fn(async () => ({
        blob: new Blob(["x"], { type: "image/jpeg" }),
        sizeBytes: 260 * 1024, // over cap
        width: 900,
        height: 675,
        quality: 0.35,
        passes: 8,
        underLimit: false,
      })),
    });
    const { outcome } = await run(deps);
    expect(outcome.kind).toBe("error");
    expect(outcome.title).toMatch(/too large/i);
    expect(deps.submitCheckin).not.toHaveBeenCalled();
  });

  it("allows submission at exactly the cap", async () => {
    const deps = makeDeps({
      compressSelfie: vi.fn(async () => ({
        blob: new Blob(["x"], { type: "image/jpeg" }),
        sizeBytes: 204800,
        width: 900,
        height: 675,
        quality: 0.5,
        passes: 3,
        underLimit: true,
      })),
    });
    await run(deps);
    expect(deps.submitCheckin).toHaveBeenCalledTimes(1);
  });
});

describe("geofence pre-check", () => {
  it("rejects before capture when the employee is outside the radius", async () => {
    const deps = makeDeps({
      getCurrentPosition: vi.fn(async () => ({
        lat: OFFICES.south.lat,
        lng: OFFICES.south.lng,
        accuracy: 8,
        timestamp: Date.now(),
      })),
    });
    const { outcome } = await run(deps);
    expect(outcome.kind).toBe("rejected");
    expect(outcome.title).toBe("Outside office geofence");
    // Never opens the camera for a check-in that cannot succeed.
    expect(deps.captureSelfie).not.toHaveBeenCalled();
    expect(deps.submitCheckin).not.toHaveBeenCalled();
  });
});

describe("permissions", () => {
  it("blocks on denied camera permission and surfaces canAskAgain", async () => {
    const deps = makeDeps({
      ensureCameraPermission: vi.fn(async () => ({ granted: false, canAskAgain: false })),
    });
    const { outcome } = await run(deps);
    expect(outcome.kind).toBe("blocked");
    expect(outcome.canAskAgain).toBe(false);
    expect(deps.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("blocks on denied location permission", async () => {
    const deps = makeDeps({
      ensureLocationPermission: vi.fn(async () => ({ granted: false, canAskAgain: true })),
    });
    const { outcome } = await run(deps);
    expect(outcome.kind).toBe("blocked");
    expect(outcome.title).toMatch(/location/i);
  });
});

describe("liveness", () => {
  it("forwards a liveness failure to the backend rather than deciding locally", async () => {
    const deps = makeDeps({
      submitCheckin: vi.fn(async () => ({
        status: "rejected",
        reason: "liveness_failed",
        face_match_score: null,
      })),
    });
    const { outcome } = await run(deps, { runLiveness: async () => false });
    expect(deps.submitCheckin.mock.calls[0][0].liveness_passed).toBe(false);
    expect(outcome.title).toBe("Liveness check failed");
  });
});

describe("step ordering", () => {
  it("runs cheap local checks before opening the camera or uploading", async () => {
    const steps = [];
    const deps = makeDeps();
    await run(deps, { onStep: (s) => steps.push(s) });
    expect(steps).toEqual([
      "permissions",
      "locating",
      "geofence",
      "antispoof",
      "capture",
      "liveness",
      "compressing",
      "submitting",
    ]);
  });
});

describe("interpretCheckinResponse covers every documented outcome", () => {
  const cases = [
    [{ status: "approved", face_match_score: 96 }, "success"],
    [{ status: "flagged", reason: "low_face_match", face_match_score: 78 }, "review"],
    [{ status: "rejected", reason: "outside_geofence" }, "rejected"],
    [{ status: "rejected", reason: "mock_location_detected" }, "rejected"],
    [{ status: "rejected", reason: "liveness_failed" }, "rejected"],
    [{ status: "rejected", reason: "pin_mismatch" }, "rejected"],
    [{ status: "rejected", reason: "low_face_match" }, "rejected"],
    [{ status: "error", reason: "network_error" }, "error"],
    [{ status: "error", reason: "invalid_request" }, "error"],
    [{ status: "error", reason: "server_error" }, "error"],
  ];

  it.each(cases)("maps %o to kind %s", (res, kind) => {
    const out = interpretCheckinResponse(res);
    expect(out.kind).toBe(kind);
    expect(typeof out.title).toBe("string");
    expect(out.title.length).toBeGreaterThan(0);
  });

  it("uses the exact contract wording for pin_mismatch and mock_location_detected", () => {
    expect(interpretCheckinResponse({ status: "rejected", reason: "pin_mismatch" }).message).toBe(
      "Incorrect PIN."
    );
    expect(
      interpretCheckinResponse({ status: "rejected", reason: "mock_location_detected" }).message
    ).toContain("simulated location detected");
  });

  it("keeps transient errors visually distinct from rejections", () => {
    expect(interpretCheckinResponse({ status: "error", reason: "network_error" }).kind).not.toBe(
      "rejected"
    );
  });
});
