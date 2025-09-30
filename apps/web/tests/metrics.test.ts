import { describe, expect, it } from "vitest";

import { METRIC_DICTIONARY } from "@/lib/metrics";

describe("metric dictionary", () => {
  it("includes expected keys", () => {
    expect(Object.keys(METRIC_DICTIONARY)).toEqual([
      "capital",
      "openRisk",
      "pnl",
      "boosts",
      "efficiency"
    ]);
  });

  it("has non-empty descriptions", () => {
    for (const entry of Object.values(METRIC_DICTIONARY)) {
      expect(entry.description.length).toBeGreaterThan(4);
      expect(entry.formula.length).toBeGreaterThan(4);
    }
  });
});
