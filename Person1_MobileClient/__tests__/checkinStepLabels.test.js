import { describe, it, expect, vi } from "vitest";

/**
 * Regression test for a real bug found by the final master audit.
 *
 * `checkinService.js` emits nine step names via `onStep(...)`. `CheckInScreen`
 * renders the CTA as `STEP_LABELS[step]` — so a step with no label rendered the
 * primary button COMPLETELY BLANK. The missing one was `uploading`: the S3
 * upload, which is the slowest step on mobile data and precisely the moment an
 * employee is most likely to assume the app has hung and kill it mid-check-in.
 *
 * Nothing caught it, because `checkinFlow.test.js` exercises the service and
 * never renders the screen. This test pins the two together directly.
 *
 * The screen pulls in Capacitor plugins transitively (hardware.js), so those are
 * stubbed — this test is only about the label map, not the component tree.
 */
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "web", isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/camera", () => ({ Camera: {}, CameraResultType: {}, CameraSource: {} }));
vi.mock("@capacitor/geolocation", () => ({ Geolocation: {} }));
vi.mock("@capacitor/app", () => ({ App: { addListener: () => ({ remove: () => {} }) } }));

const { CHECKIN_STEPS } = await import("../src/lib/checkinService.js");
const { STEP_LABELS } = await import("../src/screens/CheckInScreen.jsx");

describe("check-in step labels", () => {
  it("has a non-empty label for EVERY step the service emits", () => {
    const missing = CHECKIN_STEPS.filter((step) => !STEP_LABELS[step]);
    expect(missing).toEqual([]);
  });

  it("labels the upload step specifically — the one that used to render blank", () => {
    expect(CHECKIN_STEPS).toContain("uploading");
    expect(STEP_LABELS.uploading).toBeTruthy();
  });

  it("does not label 'submitting' as an upload — they are two different steps", () => {
    expect(STEP_LABELS.submitting).not.toBe(STEP_LABELS.uploading);
  });

  it("defines no label for a step the service never emits (dead labels rot)", () => {
    const orphans = Object.keys(STEP_LABELS).filter((key) => !CHECKIN_STEPS.includes(key));
    expect(orphans).toEqual([]);
  });
});
