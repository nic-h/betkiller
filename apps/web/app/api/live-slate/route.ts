import { NextResponse } from "next/server";
import { getLiveSlate } from "@/lib/db";

const CHAIN_ID = 8453;

const toMicrosString = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  return BigInt(Math.round(value * 1_000_000)).toString();
};

export async function GET() {
  try {
    const rows = getLiveSlate().map((item) => ({
      marketId: item.marketId,
      title: item.title,
      cutoffTs: item.cutoffTs,
      boostTotal: toMicrosString(item.boostTotal),
      volume24h: toMicrosString(item.volume24h),
      uniqueTraders24h: item.uniqueTraders24h,
      edgeScore: item.edgeScore,
      tvl: toMicrosString(item.tvl),
      depth: toMicrosString(item.depth)
    }));
    return NextResponse.json({ chainId: CHAIN_ID, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
