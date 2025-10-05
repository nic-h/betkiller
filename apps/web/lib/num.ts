export type MicroValue = number | string | bigint | null | undefined;

export const fromMicros = (value?: MicroValue): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value / 1_000_000;
  if (typeof value === "bigint") return Number(value) / 1_000_000;
  const trimmed = String(value).trim();
  if (!trimmed) return 0;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed / 1_000_000 : 0;
};

const USD_LOCALE = "en-US";

export const usd = (value: number): string =>
  value.toLocaleString(USD_LOCALE, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
