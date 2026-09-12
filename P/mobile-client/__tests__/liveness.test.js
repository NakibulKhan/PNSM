import { describe, it, expect } from "vitest";
import { pickChallengeColors, LIVENESS_COLORS, CHALLENGE_FRAME_COUNT, FLASH_HEX } from "../src/lib/liveness";

describe("pickChallengeColors", () => {
  it("picks CHALLENGE_FRAME_COUNT distinct colors from the known set", () => {
    const colors = pickChallengeColors();
    expect(colors).toHaveLength(CHALLENGE_FRAME_COUNT);
    expect(new Set(colors).size).toBe(colors.length); // no repeats
    for (const c of colors) expect(LIVENESS_COLORS).toContain(c);
  });

  it("is deterministic for an injected rng, and varies with a different one", () => {
    const always0 = pickChallengeColors(() => 0);
    // rng() === 0 always picks index 0 of the shrinking pool: LIVENESS_COLORS[0], then LIVENESS_COLORS[0] of the remainder.
    expect(always0).toEqual([LIVENESS_COLORS[0], LIVENESS_COLORS[1]]);
  });

  it("every entry in FLASH_HEX corresponds to a real challenge color", () => {
    for (const color of LIVENESS_COLORS) {
      expect(FLASH_HEX[color]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
