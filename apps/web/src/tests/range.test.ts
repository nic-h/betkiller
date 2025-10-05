import { describe, expect, it } from "vitest";

import { formatRangeLabel, normalizeRange, toSeconds, RANGE_DEFAULT, RANGE_OPTIONS } from "@/lib/range";

describe("range helpers", () => {
  it("normalizes aliases", () => {
    expect(normalizeRange("24H")).toBe("24h");
    expect(normalizeRange("1w")).toBe("1w");
    expect(normalizeRange("1m")).toBe("1m");
    expect(normalizeRange("unknown")).toBe(RANGE_DEFAULT);
  });

  it("formats range labels", () => {
    expect(formatRangeLabel("24h")).toBe("24h");
    expect(formatRangeLabel("1w")).toBe("1w");
    expect(formatRangeLabel("1m")).toBe("1m");
  });

  it("returns window seconds", () => {
    expect(toSeconds("24h")).toBe(24 * 60 * 60);
    expect(toSeconds("1w")).toBe(7 * 24 * 60 * 60);
    expect(toSeconds("1m")).toBe(30 * 24 * 60 * 60);
  });

  it("accepts existing range keys", () => {
    for (const key of RANGE_OPTIONS) {
      expect(normalizeRange(key)).toBe(key);
    }
  });

  it("falls back to default when empty", () => {
    expect(normalizeRange(null)).toBe(RANGE_DEFAULT);
    expect(normalizeRange(undefined)).toBe(RANGE_DEFAULT);
    expect(normalizeRange("" as string)).toBe(RANGE_DEFAULT);
  });
});
