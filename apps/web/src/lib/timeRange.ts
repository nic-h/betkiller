export type TimeRangeKey = "24h" | "7d" | "30d" | "1w" | "1m";

const RANGE_SECONDS: Record<TimeRangeKey, number> = {
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
  "1w": 7 * 24 * 60 * 60,
  "1m": 30 * 24 * 60 * 60
};

export function normalizeRange(value: unknown): TimeRangeKey {
  if (value === "7d" || value === "30d" || value === "1w" || value === "1m") return value;
  return "24h";
}

export function rangeToSeconds(range: TimeRangeKey): number {
  return RANGE_SECONDS[range];
}
