import { getDb } from "@/lib/db";
import { formatFP } from "@/lib/fp";
import { getSpotPrice } from "@/context/pricing";

export type NearResolutionMarket = {
  market: string;
  question: string | null;
  shortText: string | null;
  endTime: number | null;
  pYes: string;
  updatedTs: number | null;
};

export async function getNearResolutionMarkets(limit = 6): Promise<NearResolutionMarket[]> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const rows = db
    .prepare(
      `SELECT market, question, short_text, end_time, updated_ts
       FROM markets
       WHERE COALESCE(resolved, 0) = 0
       ORDER BY CASE WHEN end_time IS NULL THEN 1 ELSE 0 END, end_time ASC
       LIMIT ?`
    )
    .all(limit) as Array<{ market: string; question?: string; short_text?: string; end_time?: number; updated_ts?: number }>;

  const results: NearResolutionMarket[] = [];
  for (const row of rows) {
    const state = await getSpotPrice(row.market); // refresh cache/pricing
    if (state.resolved) {
      continue;
    }
    const priceRow = db
      .prepare(`SELECT p_yes_fp FROM market_price WHERE market = ?`)
      .get(row.market) as { p_yes_fp?: string } | undefined;
    const pYes = priceRow?.p_yes_fp ? formatFP(BigInt(priceRow.p_yes_fp), 6, 2) : "—";

    results.push({
      market: row.market,
      question: row.question ?? null,
      shortText: row.short_text ?? null,
      endTime: row.end_time ?? null,
      pYes,
      updatedTs: row.updated_ts ?? null
    });
  }

  // Sort by soonest end time after refreshing state
  results.sort((a, b) => {
    const tsA = a.endTime ?? Number.MAX_SAFE_INTEGER;
    const tsB = b.endTime ?? Number.MAX_SAFE_INTEGER;
    if (tsA === tsB) {
      return (a.updatedTs ?? now) - (b.updatedTs ?? now);
    }
    return tsA - tsB;
  });

  return results.slice(0, limit);
}
