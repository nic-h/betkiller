import { NextResponse } from "next/server";
import { db, cutoff, hasTable } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "24h";
  const since = cutoff(range);
  const database = db();

  const tvlRow = database
    .prepare(
      `SELECT COALESCE(ROUND(SUM(CAST(s.totalUsdc AS INTEGER))/1e6, 2), 0) AS tvl
       FROM (
         SELECT marketId, MAX(ts) AS ts
         FROM market_state
         GROUP BY marketId
       ) mx
       JOIN market_state s ON s.marketId = mx.marketId AND s.ts = mx.ts`
    )
    .get() as { tvl?: number } | undefined;

  const activeWalletsRow = database
    .prepare(
      `SELECT COUNT(DISTINCT addr) AS n FROM (
         SELECT lower(trader) AS addr FROM trades WHERE ts >= ? AND trader IS NOT NULL
         UNION
         SELECT lower(user) FROM locks WHERE ts >= ? AND user IS NOT NULL
       )`
    )
    .get(since, since) as { n?: number } | undefined;

  const totalMarketsRow = database.prepare(`SELECT COUNT(*) AS n FROM markets`).get() as { n?: number } | undefined;

  let marketsResolved = 0;
  if (hasTable("resolutions")) {
    const resolvedRow = database.prepare(`SELECT COUNT(*) AS n FROM resolutions`).get() as { n?: number } | undefined;
    marketsResolved = resolvedRow?.n ?? 0;
  }
  const marketsTotal = totalMarketsRow?.n ?? 0;
  const marketsActive = Math.max(0, marketsTotal - marketsResolved);

  const volumeRow = database
    .prepare(
      `SELECT COALESCE(ROUND(SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER))/1e6, 2), 0) AS v
       FROM trades
       WHERE ts >= ?`
    )
    .get(since) as { v?: number } | undefined;

  const boostsRow = database
    .prepare(
      `SELECT COALESCE(ROUND(SUM(CAST(COALESCE(json_extract(payloadJson, '$.userPaid'), 0) AS INTEGER))/1e6, 2), 0) AS b
       FROM locks
       WHERE ts >= ?`
    )
    .get(since) as { b?: number } | undefined;

  return NextResponse.json({
    range,
    tvl: tvlRow?.tvl ?? 0,
    activeWallets: activeWalletsRow?.n ?? 0,
    marketsActive,
    marketsResolved,
    vol: volumeRow?.v ?? 0,
    boosts: boostsRow?.b ?? 0
  });
}
