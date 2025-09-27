import { NextResponse } from "next/server";
import { db, cutoff, hasTable } from "@/lib/db";

const CHAIN_ID = 8453;

const toMicrosString = (value: unknown): string => {
  if (value === null || value === undefined) return "0";
  if (typeof value === "string") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return Math.trunc(value).toString();
  try {
    return BigInt(value as any).toString();
  } catch (error) {
    return String(value ?? 0);
  }
};

const SORTABLE = new Set(["pnl", "volume", "rewards"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") ?? "14d").toLowerCase();
  const since = cutoff(range);
  const sortParam = searchParams.get("sort") ?? "pnl";
  const sort = SORTABLE.has(sortParam) ? sortParam : "pnl";
  const limit = Number(searchParams.get("limit") ?? 100);
  const offset = Number(searchParams.get("offset") ?? 0);

  const database = db();
  const hasRewards = hasTable("reward_claims");
  const hasRedeems = hasTable("redemptions");
  const hasSponsoredLocks = hasTable("sponsored_locks");

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

  const boostsCTE = hasSponsoredLocks
    ? `SELECT lower(user) AS addr,
             SUM(CAST(COALESCE(userPaid, 0) AS INTEGER)) AS boostPaid,
             SUM(CAST(COALESCE(subsidyUsed, 0) AS INTEGER)) AS boostSponsored
       FROM sponsored_locks
       WHERE ts >= ? AND user IS NOT NULL
       GROUP BY lower(user)`
    : `SELECT lower(user) AS addr,
             SUM(CAST(COALESCE(json_extract(payloadJson, '$.userPaid'), 0) AS INTEGER)) AS boostPaid,
             SUM(CAST(COALESCE(json_extract(payloadJson, '$.subsidyUsed'), 0) AS INTEGER)) AS boostSponsored
       FROM locks
       WHERE ts >= ? AND user IS NOT NULL
       GROUP BY lower(user)`;

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
    b AS (${boostsCTE}),
    w AS (${redeemsCTE})
    SELECT lower(COALESCE(t.addr, r.addr, b.addr, w.addr)) AS addr,
           COALESCE(w.winnings, 0) + COALESCE(r.rewards, 0) - COALESCE(t.netBuys, 0) AS pnl,
           COALESCE(r.rewards, 0) AS claimedRewards,
           COALESCE(b.boostPaid, 0) AS boostSpend,
           CASE
             WHEN COALESCE(b.boostPaid, 0) > 0 THEN (1.0 * (COALESCE(r.rewards, 0) - COALESCE(b.boostPaid, 0))) / COALESCE(b.boostPaid, 0)
             ELSE NULL
           END AS boostROI,
           ROUND(1.0 * COALESCE(w.winningMarkets, 0) / NULLIF(t.marketsTouched, 0), 4) AS winRate,
           COALESCE(t.volume, 0) AS volume,
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
    pnl: number | string | null;
    claimedRewards: number | string | null;
    boostSpend: number | string | null;
    boostROI: number | null;
    winRate: number | null;
    volume: number | string | null;
    marketsTouched: number | null;
    lastSeen: number | null;
  }>;

  return NextResponse.json({
    chainId: CHAIN_ID,
    range,
    sort,
    limit,
    offset,
    rows: rows.map((row) => ({
      addr: row.addr,
      pnl: toMicrosString(row.pnl ?? 0),
      claimedRewards: toMicrosString(row.claimedRewards ?? 0),
      boostSpend: toMicrosString(row.boostSpend ?? 0),
      boostROI: row.boostROI ?? null,
      winRate: row.winRate ?? null,
      volume: toMicrosString(row.volume ?? 0),
      marketsTouched: row.marketsTouched ?? 0,
      lastSeen: row.lastSeen ?? 0
    }))
  });
}
