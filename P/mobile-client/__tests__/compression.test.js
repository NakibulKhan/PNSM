import { describe, it, expect } from "vitest";
import { isUnderSizeLimit, fitDimensions, MAX_SELFIE_BYTES } from "../src/lib/compression";

describe("isUnderSizeLimit — the hard 200KB gate", () => {
  it("accepts a payload under the cap", () => {
    expect(isUnderSizeLimit(150 * 1024)).toBe(true);
  });
  it("accepts a payload exactly at the cap", () => {
    expect(isUnderSizeLimit(MAX_SELFIE_BYTES)).toBe(true);
  });
  it("rejects one byte over the cap", () => {
    expect(isUnderSizeLimit(MAX_SELFIE_BYTES + 1)).toBe(false);
  });
  it("rejects a grossly oversized payload", () => {
    expect(isUnderSizeLimit(4 * 1024 * 1024)).toBe(false);
  });
  it("rejects missing/zero/invalid sizes rather than passing them through", () => {
    expect(isUnderSizeLimit(0)).toBe(false);
    expect(isUnderSizeLimit(null)).toBe(false);
    expect(isUnderSizeLimit(undefined)).toBe(false);
    expect(isUnderSizeLimit(NaN)).toBe(false);
  });
  it("confirms the cap is exactly 200KB per api-contract.md", () => {
    expect(MAX_SELFIE_BYTES).toBe(204800);
  });
});

describe("fitDimensions", () => {
  it("leaves already-small images untouched", () => {
    expect(fitDimensions(640, 480)).toEqual({ width: 640, height: 480 });
  });
  it("scales the long edge down to the cap, preserving aspect ratio", () => {
    const r = fitDimensions(4000, 3000, 900);
    expect(r.width).toBe(900);
    expect(r.height).toBe(675);
  });
  it("handles portrait orientation", () => {
    const r = fitDimensions(3000, 4000, 900);
    expect(r.height).toBe(900);
    expect(r.width).toBe(675);
  });
  it("degrades safely on zero input", () => {
    expect(fitDimensions(0, 0)).toEqual({ width: 0, height: 0 });
  });
});
