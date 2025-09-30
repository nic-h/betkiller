import { NextResponse } from "next/server";
import { getLiveSlate } from "@/lib/db";
import { ensureRange } from "@/lib/range";

const CHAIN_ID = 8453;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = ensureRange(searchParams.get("range"));
  try {
    const rows = getLiveSlate(range).map((item) => ({
      marketId: item.marketId,
      title: item.title,
      cutoffTs: item.cutoffTs,
      boostTotal: item.boostTotal,
      volumeRange: item.volumeRange,
      uniqueTraders: item.uniqueTraders,
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
    return NextResponse.json({ chainId: CHAIN_ID, range, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
