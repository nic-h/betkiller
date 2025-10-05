import { formatUnits, parseUnits } from "viem";

const USD_DECIMALS = 6;

export function parseUsd(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return parseUnits(value.toString(), USD_DECIMALS);
  }
  return parseUnits(value, USD_DECIMALS);
}

export function usdToDecimalString(value: bigint): string {
  return formatUnits(value, USD_DECIMALS);
}

export function formatUSD(value: bigint, fractionDigits = 2): string {
  const scale = 10n ** BigInt(USD_DECIMALS);
  const targetScale = 10n ** BigInt(fractionDigits);
  const abs = value < 0n ? -value : value;
  const rounded = (abs * targetScale + scale / 2n) / scale;
  const integer = rounded / targetScale;
  const fraction = rounded % targetScale;
  const fractionStr = fraction.toString().padStart(fractionDigits, "0");
  const sign = value < 0n ? "-" : "";
  if (fractionDigits === 0) {
    return `${sign}${integer.toString()}`;
  }
  return `${sign}${integer.toString()}.${fractionStr}`;
}
