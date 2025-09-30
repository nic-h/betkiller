import { describe, expect, it } from "vitest";

import { ensureRange, formatRangeLabel, normalizeRange, toSeconds } from "@/lib/range";

describe("range helpers", () => {
  it("normalizes aliases", () => {
    expect(normalizeRange("24H")).toBe("24h");
    expect(normalizeRange("1w")).toBe("7d");
    expect(normalizeRange("1m")).toBe("30d");
    expect(normalizeRange("unknown")).toBeNull();
  });

  it("ensures fallback", () => {
    expect(ensureRange("7d")).toBe("7d");
    expect(ensureRange("something")).toBe("24h");
    expect(ensureRange(null)).toBe("24h");
  });

  it("formats range labels", () => {
    expect(formatRangeLabel("24h")).toBe("24h");
    expect(formatRangeLabel("7d")).toBe("1w");
    expect(formatRangeLabel("30d")).toBe("1m");
  });

  it("returns window seconds", () => {
    expect(toSeconds("24h")).toBe(24 * 60 * 60);
    expect(toSeconds("7d")).toBe(7 * 24 * 60 * 60);
    expect(toSeconds("30d")).toBe(30 * 24 * 60 * 60);
  });
});
