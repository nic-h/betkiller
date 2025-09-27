import { NextResponse } from "next/server";
import { db, cutoff, hasTable } from "@/lib/db";

const STATUS_OPTIONS = new Set(["active", "resolved", "all"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") ?? "14d").toLowerCase();
  const since = cutoff(range);
  const statusParam = searchParams.get("status") ?? "active";
  const status = STATUS_OPTIONS.has(statusParam) ? statusParam : "active";
  const limit = Number(searchParams.get("limit") ?? 100);
  const offset = Number(searchParams.get("offset") ?? 0);

  const database = db();
  const hasResolutions = hasTable("resolutions");

  const statusExpr = hasResolutions
    ? "CASE WHEN res.marketId IS NOT NULL THEN 'resolved' ELSE 'active' END"
    : "'active'";

  const resolutionsJoin = hasResolutions ? "LEFT JOIN resolutions res ON res.marketId = m.marketId" : "";

  const sql = `
    WITH latest AS (
      SELECT marketId, MAX(ts) AS ts
      FROM market_state
      GROUP BY marketId
    ),
    state AS (
      SELECT m.marketId,
             ${statusExpr} AS status,
             m.creator,
             NULL AS cutoffAt,
             s.totalUsdc
      FROM markets m
      LEFT JOIN latest mx ON mx.marketId = m.marketId
      LEFT JOIN market_state s ON s.marketId = mx.marketId AND s.ts = mx.ts
      ${resolutionsJoin}
    ),
    vol AS (
      SELECT marketId, SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS volumeMicros
      FROM trades
      WHERE ts >= ?
      GROUP BY marketId
    ),
    actors AS (
      SELECT marketId, COUNT(DISTINCT lower(trader)) AS traders
      FROM trades
      WHERE trader IS NOT NULL AND ts >= ?
      GROUP BY marketId
    ),
    boosts AS (
      SELECT marketId,
             SUM(CAST(COALESCE(userPaid, 0) AS INTEGER)) AS paid,
             SUM(CAST(COALESCE(subsidyUsed, 0) AS INTEGER)) AS sponsored
      FROM sponsored_locks
      WHERE ts >= ?
      GROUP BY marketId
    )
    SELECT s.marketId,
           s.status,
           s.creator,
           s.cutoffAt,
           COALESCE(s.totalUsdc, '0') AS tvlMicros,
           COALESCE(vol.volumeMicros, 0) AS volumeMicros,
           COALESCE(actors.traders, 0) AS traders,
           COALESCE(boosts.paid, 0) AS boostPaidMicros,
           COALESCE(boosts.sponsored, 0) AS boostSponsoredMicros
    FROM state s
    LEFT JOIN vol ON vol.marketId = s.marketId
    LEFT JOIN actors ON actors.marketId = s.marketId
    LEFT JOIN boosts ON boosts.marketId = s.marketId
    WHERE (? = 'all' OR s.status = ?)
    ORDER BY CAST(tvlMicros AS INTEGER) DESC
    LIMIT ? OFFSET ?`;

  const rows = database
    .prepare(sql)
    .all(since, since, since, status, status, limit, offset) as Array<{
      marketId: string;
      status: string;
      creator: string | null;
      cutoffAt: number | null;
      tvlMicros: string;
      volumeMicros: number | string | null;
      traders: number;
      boostPaidMicros: number | string | null;
      boostSponsoredMicros: number | string | null;
    }>;

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

  const enriched = rows.map((row) => ({
    marketId: row.marketId,
    status: row.status,
    creator: row.creator,
    cutoffAt: row.cutoffAt ?? null,
    tvl: toMicrosString(row.tvlMicros),
    volume: toMicrosString(row.volumeMicros),
    traders: row.traders ?? 0,
    boostPaid: toMicrosString(row.boostPaidMicros),
    boostSponsored: toMicrosString(row.boostSponsoredMicros)
  }));

  return NextResponse.json({ chainId: 8453, range, status, limit, offset, rows: enriched });
}
