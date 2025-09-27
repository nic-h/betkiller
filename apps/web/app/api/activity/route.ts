import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sinceParam = Number(searchParams.get("since") ?? Date.now() - 24 * 3600 * 1000);
  const limit = Number(searchParams.get("limit") ?? 200);
  const sinceSeconds = Math.floor(sinceParam / 1000);

  const database = db();

  const created = database
    .prepare(
      `SELECT createdAt AS ts, marketId, lower(creator) AS wallet, NULL AS amount, txHash, 'create' AS kind
       FROM markets
       WHERE createdAt >= ?`
    )
    .all(sinceSeconds) as Array<{ ts: number; marketId: string; wallet: string | null; amount: number | null; txHash: string | null; kind: string }>;

  const trades = database
    .prepare(
      `SELECT ts,
              marketId,
              lower(trader) AS wallet,
              CASE WHEN CAST(usdcIn AS INTEGER) > 0 THEN CAST(usdcIn AS INTEGER)
                   ELSE CAST(usdcOut AS INTEGER) END AS amount,
              txHash,
              'trade' AS kind
       FROM trades
       WHERE ts >= ?`
    )
    .all(sinceSeconds) as Array<{ ts: number; marketId: string; wallet: string | null; amount: number | null; txHash: string | null; kind: string }>;

  const boosts = database
    .prepare(
      `SELECT ts,
              marketId,
              lower(user) AS wallet,
              CAST(COALESCE(json_extract(payloadJson, '$.userPaid'), 0) AS INTEGER) AS amount,
              NULL AS txHash,
              'boost' AS kind
       FROM locks
       WHERE ts >= ?`
    )
    .all(sinceSeconds) as Array<{ ts: number; marketId: string; wallet: string | null; amount: number | null; txHash: string | null; kind: string }>;

  const rows = [...created, ...trades, ...boosts]
    .map((row) => ({
      ...row,
      wallet: row.wallet ?? null,
      amount: row.amount != null ? Number(row.amount) / 1e6 : null
    }))
    .sort((a, b) => a.ts - b.ts)
    .slice(-limit)
    .reverse();

  return NextResponse.json({ since: sinceParam, limit, rows });
}
