import { NextResponse } from "next/server";
import { db, cutoff, hasTable } from "@/lib/db";

const SORTABLE = new Set(["pnl", "volume", "rewards"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "7d";
  const since = cutoff(range);
  const sortParam = searchParams.get("sort") ?? "pnl";
  const sort = SORTABLE.has(sortParam) ? sortParam : "pnl";
  const limit = Number(searchParams.get("limit") ?? 100);
  const offset = Number(searchParams.get("offset") ?? 0);

  const database = db();
  const hasRewards = hasTable("reward_claims");
  const hasRedeems = hasTable("redemptions");

  const rewardsCTE = hasRewards
    ? `SELECT lower(user) AS addr, SUM(CAST(amount AS INTEGER)) AS rewards
       FROM reward_claims
       WHERE ts >= ?
       GROUP BY lower(user)`
    : `SELECT NULL AS addr, 0 AS rewards`;

  const redeemsCTE = hasRedeems
    ? `SELECT lower(user) AS addr,
              COUNT(DISTINCT marketId) AS winningMarkets,
              SUM(CAST(payout AS INTEGER)) AS winnings
       FROM redemptions
       WHERE ts >= ?
       GROUP BY lower(user)`
    : `SELECT NULL AS addr, 0 AS winningMarkets, 0 AS winnings`;

  const sql = `
    WITH t AS (
      SELECT lower(trader) AS addr,
             SUM(CAST(usdcIn AS INTEGER) - CAST(usdcOut AS INTEGER)) AS netBuys,
             SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS volume,
             COUNT(DISTINCT marketId) AS marketsTouched,
             MAX(ts) AS lastSeen
      FROM trades
      WHERE trader IS NOT NULL AND ts >= ?
      GROUP BY lower(trader)
    ),
    r AS (${rewardsCTE}),
    b AS (
      SELECT lower(user) AS addr,
             SUM(CAST(COALESCE(json_extract(payloadJson, '$.userPaid'), 0) AS INTEGER)) AS boostPaid,
             SUM(CAST(COALESCE(json_extract(payloadJson, '$.subsidyUsed'), 0) AS INTEGER)) AS boostSponsored
      FROM locks
      WHERE user IS NOT NULL AND ts >= ?
      GROUP BY lower(user)
    ),
    w AS (${redeemsCTE})
    SELECT lower(COALESCE(t.addr, r.addr, b.addr, w.addr)) AS addr,
           ROUND((COALESCE(w.winnings, 0) + COALESCE(r.rewards, 0) - COALESCE(t.netBuys, 0)) / 1e6, 2) AS pnl,
           ROUND(COALESCE(r.rewards, 0) / 1e6, 2) AS claimedRewards,
           ROUND(COALESCE(b.boostPaid, 0) / 1e6, 2) AS boostSpend,
           ROUND((COALESCE(r.rewards, 0) - COALESCE(b.boostPaid, 0)) / 1e6, 2) AS boostROI,
           ROUND(1.0 * COALESCE(w.winningMarkets, 0) / NULLIF(t.marketsTouched, 0), 4) AS winRate,
           ROUND(COALESCE(t.volume, 0) / 1e6, 2) AS volume,
           COALESCE(t.marketsTouched, 0) AS marketsTouched,
           COALESCE(t.lastSeen, 0) AS lastSeen
    FROM t
    LEFT JOIN r USING (addr)
    LEFT JOIN b USING (addr)
    LEFT JOIN w USING (addr)
    WHERE addr IS NOT NULL
    ORDER BY ${sort === "volume" ? "volume" : sort === "rewards" ? "claimedRewards" : "pnl"} DESC
    LIMIT ? OFFSET ?`;

  const params: Array<number> = [since];
  if (hasRewards) params.push(since);
  params.push(since);
  if (hasRedeems) params.push(since);
  params.push(limit, offset);

  const rows = database.prepare(sql).all(...params) as Array<{
    addr: string;
    pnl: number;
    claimedRewards: number;
    boostSpend: number;
    boostROI: number;
    winRate: number | null;
    volume: number;
    marketsTouched: number;
    lastSeen: number;
  }>;

  return NextResponse.json({ range, sort, limit, offset, rows });
}
