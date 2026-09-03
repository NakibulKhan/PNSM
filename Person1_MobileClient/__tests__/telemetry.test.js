import { describe, it, expect, vi, beforeEach } from "vitest";

const getPlatform = vi.fn();
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: (...args) => getPlatform(...args) } }));

const { isWithinTrackingWindow, backoffMs, DEFAULT_HEARTBEAT_MS, getBatteryOptimizationGuidance } = await import(
  "../src/lib/backgroundTelemetry"
);

const SHIFT = { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] };

describe("isWithinTrackingWindow — privacy boundary, not just a feature flag", () => {
  it("tracks during shift hours on a working day", () => {
    // Mon 31 Aug 2026, 10:30
    expect(isWithinTrackingWindow(new Date(2026, 7, 31, 10, 30), SHIFT)).toBe(true);
  });
  it("does NOT track before the shift starts", () => {
    expect(isWithinTrackingWindow(new Date(2026, 7, 31, 7, 0), SHIFT)).toBe(false);
  });
  it("does NOT track after the shift ends", () => {
    expect(isWithinTrackingWindow(new Date(2026, 7, 31, 19, 0), SHIFT)).toBe(false);
  });
  it("does NOT track on a non-working day even during shift hours", () => {
    // Sun 30 Aug 2026
    expect(isWithinTrackingWindow(new Date(2026, 7, 30, 10, 30), SHIFT)).toBe(false);
  });
  it("treats the end hour as exclusive", () => {
    expect(isWithinTrackingWindow(new Date(2026, 7, 31, 18, 0), SHIFT)).toBe(false);
    expect(isWithinTrackingWindow(new Date(2026, 7, 31, 17, 59), SHIFT)).toBe(true);
  });
  it("never tracks when no shift is configured", () => {
    expect(isWithinTrackingWindow(new Date(), null)).toBe(false);
  });
});

describe("backoffMs", () => {
  it("uses the base interval when healthy", () => {
    expect(backoffMs(0)).toBe(DEFAULT_HEARTBEAT_MS);
  });
  it("backs off exponentially on repeated failure", () => {
    expect(backoffMs(1)).toBe(DEFAULT_HEARTBEAT_MS * 2);
    expect(backoffMs(3)).toBe(DEFAULT_HEARTBEAT_MS * 8);
  });
  it("caps the backoff so it always eventually retries", () => {
    expect(backoffMs(50)).toBe(10 * 60 * 1000);
  });
});

describe("getBatteryOptimizationGuidance", () => {
  beforeEach(() => getPlatform.mockReset());

  it("returns dontkillmyapp.com guidance on Android", () => {
    getPlatform.mockReturnValue("android");
    const guidance = getBatteryOptimizationGuidance();
    expect(guidance).toEqual({
      needed: true,
      guidanceUrl: "https://dontkillmyapp.com",
      note: expect.stringContaining("ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"),
    });
  });

  it("returns null on web (no OEM battery killer to whitelist against)", () => {
    getPlatform.mockReturnValue("web");
    expect(getBatteryOptimizationGuidance()).toBeNull();
  });

  it("returns null on iOS (this is an Android-only OEM problem)", () => {
    getPlatform.mockReturnValue("ios");
    expect(getBatteryOptimizationGuidance()).toBeNull();
  });
});
