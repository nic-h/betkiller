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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") ?? "14d").toLowerCase();
  const since = cutoff(range);
  const database = db();

  const tvlRow = database
    .prepare(
      `SELECT COALESCE(SUM(CAST(s.totalUsdc AS INTEGER)), 0) AS tvl
       FROM (
         SELECT marketId, MAX(ts) AS ts
         FROM market_state
         GROUP BY marketId
       ) mx
       JOIN market_state s ON s.marketId = mx.marketId AND s.ts = mx.ts`
    )
    .get() as { tvl?: number | string | null } | undefined;

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
      `SELECT COALESCE(SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)), 0) AS volume
       FROM trades
       WHERE ts >= ?`
    )
    .get(since) as { volume?: number | string | null } | undefined;

  let boostsValue: number | string | null = 0;
  if (hasTable("sponsored_locks")) {
    const row = database
      .prepare(
        `SELECT COALESCE(SUM(CAST(COALESCE(userPaid, 0) AS INTEGER) + CAST(COALESCE(subsidyUsed, 0) AS INTEGER)), 0) AS boosts
         FROM sponsored_locks
         WHERE ts >= ?`
      )
      .get(since) as { boosts?: number | string | null } | undefined;
    boostsValue = row?.boosts ?? 0;
  } else {
    const fallback = database
      .prepare(
        `SELECT COALESCE(SUM(CAST(COALESCE(json_extract(payloadJson, '$.userPaid'), 0) AS INTEGER)), 0) AS boosts
         FROM locks
         WHERE ts >= ?`
      )
      .get(since) as { boosts?: number | string | null } | undefined;
    boostsValue = fallback?.boosts ?? 0;
  }

  const volumeString = toMicrosString(volumeRow?.volume ?? 0);

  return NextResponse.json({
    chainId: CHAIN_ID,
    range,
    tvl: toMicrosString(tvlRow?.tvl ?? 0),
    activeWallets: activeWalletsRow?.n ?? 0,
    marketsActive,
    marketsResolved,
    volume: volumeString,
    vol: volumeString,
    boosts: toMicrosString(boostsValue)
  });
}
