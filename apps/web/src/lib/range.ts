export type RangeKey = "24h" | "1w" | "1m";

export const RANGE_OPTIONS: RangeKey[] = ["24h", "1w", "1m"];
export const RANGE_DEFAULT: RangeKey = "24h";
export const RANGE_STORAGE_KEY = "context.range";

export const normalizeRange = (value?: string | RangeKey | null): RangeKey => {
  if (value === "24h" || value === "1w" || value === "1m") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "24h" || trimmed === "1w" || trimmed === "1m") {
      return trimmed as RangeKey;
    }
  }
  return "24h";
};

export const formatRangeLabel = (value: RangeKey): string => value;

export function toSeconds(value: RangeKey): number {
  switch (value) {
    case "24h":
      return 24 * 60 * 60;
    case "1w":
      return 7 * 24 * 60 * 60;
    case "1m":
    default:
      return 30 * 24 * 60 * 60;
  }
}
