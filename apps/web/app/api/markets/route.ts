import { NextResponse } from "next/server";
import { db, cutoff, hasTable } from "@/lib/db";

const STATUS_OPTIONS = new Set(["active", "resolved", "all"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = searchParams.get("range") ?? "24h";
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
      SELECT marketId, SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS v
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
             SUM(CAST(COALESCE(json_extract(payloadJson, '$.userPaid'), 0) AS INTEGER)) AS paid,
             SUM(CAST(COALESCE(json_extract(payloadJson, '$.subsidyUsed'), 0) AS INTEGER)) AS sponsored
      FROM locks
      WHERE ts >= ?
      GROUP BY marketId
    )
    SELECT s.marketId,
           s.status,
           s.creator,
           s.cutoffAt,
           ROUND(COALESCE(s.totalUsdc, 0) / 1e6, 2) AS tvl,
           ROUND(COALESCE(vol.v, 0) / 1e6, 2) AS volume24h,
           COALESCE(actors.traders, 0) AS traders,
           ROUND(COALESCE(boosts.paid, 0) / 1e6, 2) AS boostPaid,
           ROUND(COALESCE(boosts.sponsored, 0) / 1e6, 2) AS boostSponsored
    FROM state s
    LEFT JOIN vol ON vol.marketId = s.marketId
    LEFT JOIN actors ON actors.marketId = s.marketId
    LEFT JOIN boosts ON boosts.marketId = s.marketId
    WHERE (? = 'all' OR s.status = ?)
    ORDER BY tvl DESC
    LIMIT ? OFFSET ?`;

  const rows = database
    .prepare(sql)
    .all(since, since, since, status, status, limit, offset) as Array<{
      marketId: string;
      status: string;
      creator: string | null;
      cutoffAt: number | null;
      tvl: number;
      volume24h: number;
      traders: number;
      boostPaid: number;
      boostSponsored: number;
    }>;

  return NextResponse.json({ range, status, limit, offset, rows });
}
