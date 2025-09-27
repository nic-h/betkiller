import { NextResponse } from "next/server";
import { db } from "@/lib/db";

type RouteContext = { params: { id?: string } };

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

export async function GET(request: Request, context: RouteContext) {
  const marketIdParam = context.params.id?.toLowerCase();
  if (!marketIdParam) {
    return NextResponse.json({ chainId: 8453, error: "missing_market_id" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, Math.min(500, Number(searchParams.get("limit") ?? 100)));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

  const database = db();
  const trades = database
    .prepare(
      `SELECT marketId,
              txHash,
              logIndex,
              trader,
              usdcIn,
              usdcOut,
              blockNumber,
              ts
       FROM trades
       WHERE lower(marketId) = ?
       ORDER BY ts DESC, logIndex DESC
       LIMIT ? OFFSET ?`
    )
    .all(marketIdParam, limit, offset) as Array<{
      marketId: string;
      txHash: string;
      logIndex: number;
      trader: string | null;
      usdcIn: string | number | null;
      usdcOut: string | number | null;
      blockNumber: string | null;
      ts: number;
    }>;

  const rows = trades.map((row) => ({
    marketId: row.marketId,
    txHash: row.txHash,
    logIndex: row.logIndex,
    trader: row.trader,
    usdcIn: toMicrosString(row.usdcIn),
    usdcOut: toMicrosString(row.usdcOut),
    blockNumber: row.blockNumber ?? null,
    ts: row.ts
  }));

  return NextResponse.json({ chainId: 8453, marketId: marketIdParam, limit, offset, rows });
}
