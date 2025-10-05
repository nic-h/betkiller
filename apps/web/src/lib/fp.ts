export type FP = bigint;

let cachedDecimals: number | null = null;

export function setDecimals(decimals: number) {
  cachedDecimals = decimals;
}

export function getDecimals(): number {
  return cachedDecimals ?? 6;
}

export function parseToFP(value: bigint | number | string, decimals = getDecimals()): FP {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return BigInt(Math.round(value * 10 ** decimals));
  }
  if (value.startsWith("0x")) {
    return BigInt(value);
  }
  if (value.includes(".")) {
    const [intPart, fracPart = ""] = value.split(".");
    const frac = fracPart.padEnd(decimals, "0").slice(0, decimals);
    return BigInt(intPart + frac);
  }
  return BigInt(value);
}

export function formatFP(value: FP | null | undefined, decimals = getDecimals(), fractionDigits = 2): string {
  if (value === null || value === undefined) return "—";
  const scale = 10n ** BigInt(decimals);
  const multiplier = 10n ** BigInt(fractionDigits);
  const abs = value >= 0n ? value : -value;
  const rounded = (abs * multiplier + scale / 2n) / scale;
  const integer = rounded / multiplier;
  const fraction = String(rounded % multiplier).padStart(fractionDigits, "0");
  const sign = value < 0n ? "-" : "";
  return fractionDigits === 0 ? `${sign}${integer}` : `${sign}${integer}.${fraction}`;
}
