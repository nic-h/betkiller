import { Hex, encodePacked, keccak256 } from "viem";

export function computeMarketId(creator: Hex, oracle: Hex, questionId: Hex): Hex {
  return keccak256(encodePacked(["address", "address", "bytes32"], [creator, oracle, questionId]));
}

export function toTimestampSeconds(date: bigint): number {
  return Number(date);
}

export function toHexString(value: bigint | number | Hex): string {
  if (typeof value === "string") return value;
  return `0x${BigInt(value).toString(16)}`;
}

export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") {
    if (value.startsWith("0x")) return BigInt(value);
    return BigInt(value);
  }
  throw new Error(`Cannot convert value to bigint: ${value}`);
}
