import { NextResponse } from "next/server";
import { getLiveSlate } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET() {
  try {
    const rows = getLiveSlate().map((item) => ({
      marketId: item.marketId,
      title: item.title,
      cutoffTs: item.cutoffTs,
      boostTotal: item.boostTotal,
      volume24h: item.volume24h,
      uniqueTraders24h: item.uniqueTraders24h,
      edgeScore: item.edgeScore,
      edgeBreakdown: item.edgeBreakdown,
      tvl: item.tvl,
      depth: item.depth,
      oracle: item.oracle,
      surplusRecipient: item.surplusRecipient,
      questionId: item.questionId,
      outcomes: item.outcomes,
      lastPrices: item.lastPrices,
      priceSeries: item.priceSeries,
      tvlSeries: item.tvlSeries,
      costToMove: item.costToMove,
      heuristics: item.heuristics
    }));
    return NextResponse.json({ chainId: CHAIN_ID, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
