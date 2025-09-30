import { describe, expect, it } from "vitest";

import { computeActionScore } from "@/lib/db";

describe("action queue scoring", () => {
  it("returns zero when all maxima are zero", () => {
    expect(computeActionScore(0, 0, 0, 0, 0, 0)).toBe(0);
  });

  it("weights ev, urgency, and liquidity", () => {
    const score = computeActionScore(10, 10, 5, 10, 2, 4);
    expect(score).toBeCloseTo(0.5 * 1 + 0.3 * 0.5 + 0.2 * 0.5, 4);
  });

  it("normalizes against maxima", () => {
    const score = computeActionScore(4, 8, 2, 4, 1, 2);
    expect(score).toBeCloseTo(0.5 * 0.5 + 0.3 * 0.5 + 0.2 * 0.5, 4);
  });
});
