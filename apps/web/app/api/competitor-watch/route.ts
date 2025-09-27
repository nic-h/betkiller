import { NextResponse } from "next/server";
import { getCompetitorWatch } from "@/lib/db";

const CHAIN_ID = 8453;

const toMicrosString = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  return BigInt(Math.round(value * 1_000_000)).toString();
};

export async function GET() {
  try {
    const entries = getCompetitorWatch().map((entry) => ({
      addr: entry.addr,
      name: entry.name,
      xHandle: entry.xHandle,
      markets: entry.markets.map((market) => ({
        marketId: market.marketId,
        title: market.title,
        createdAt: market.createdAt,
        boostTotal: toMicrosString(market.boostTotal)
      }))
    }));
    return NextResponse.json({ chainId: CHAIN_ID, entries });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
