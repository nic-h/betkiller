export type RangeKey = "24h" | "7d" | "30d";

export const RANGE_DEFAULT: RangeKey =
  (process.env.RANGE_DEFAULT as RangeKey | undefined) ?? "24h";

export const RANGE_STORAGE_KEY = "context.range";

const ALIASES: Record<string, RangeKey> = {
  "24h": "24h",
  "1d": "24h",
  day: "24h",
  d1: "24h",
  "1w": "7d",
  "7d": "7d",
  week: "7d",
  w1: "7d",
  "30d": "30d",
  "1m": "30d",
  month: "30d",
  m1: "30d"
};

export const RANGE_OPTIONS: RangeKey[] = ["24h", "7d", "30d"];

export const RANGE_LABEL: Record<RangeKey, string> = {
  "24h": "24h",
  "7d": "1w",
  "30d": "1m"
};

export function normalizeRange(value: string | null | undefined): RangeKey | null {
  if (!value) return null;
  const key = value.trim().toLowerCase();
  return ALIASES[key] ?? null;
}

export function ensureRange(value: string | null | undefined): RangeKey {
  return normalizeRange(value) ?? RANGE_DEFAULT;
}

export function formatRangeLabel(value: RangeKey): string {
  return RANGE_LABEL[value];
}

export function toSeconds(value: RangeKey): number {
  switch (value) {
    case "24h":
      return 24 * 60 * 60;
    case "7d":
      return 7 * 24 * 60 * 60;
    case "30d":
    default:
      return 30 * 24 * 60 * 60;
  }
}
