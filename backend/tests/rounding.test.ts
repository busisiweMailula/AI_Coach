import { describe, expect, it } from "vitest";
import { roundToTwoDecimalPlaces } from "../src/common/rounding.js";

describe("roundToTwoDecimalPlaces", () => {
  it("rounds decimal overall scores to two places", () => {
    expect(roundToTwoDecimalPlaces(3.6000000000000005)).toBe(3.60);
    expect(roundToTwoDecimalPlaces(3.456)).toBe(3.46);
  });

  it("returns a stable zero for non-finite values", () => {
    expect(roundToTwoDecimalPlaces(Number.NaN)).toBe(0);
    expect(roundToTwoDecimalPlaces(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
