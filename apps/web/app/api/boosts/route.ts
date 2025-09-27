import { NextResponse } from "next/server";
import { cutoff, db } from "@/lib/db";

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
  const marketIdFilter = searchParams.get("marketId")?.toLowerCase() ?? null;
  const limit = Math.max(1, Math.min(200, Number(searchParams.get("limit") ?? 100)));
  const offset = Math.max(0, Number(searchParams.get("offset") ?? 0));

  const database = db();

  const rows = marketIdFilter
    ? (database
        .prepare(
          `SELECT marketId,
                  COUNT(*) AS boostCount,
                  SUM(CAST(COALESCE(userPaid, 0) AS INTEGER)) AS userPaidMicros,
                  SUM(CAST(COALESCE(subsidyUsed, 0) AS INTEGER)) AS subsidyUsedMicros,
                  SUM(CAST(COALESCE(actualCost, 0) AS INTEGER)) AS actualCostMicros,
                  MAX(ts) AS latestTs
           FROM sponsored_locks
           WHERE ts >= ? AND lower(marketId) = ?
           GROUP BY marketId
           ORDER BY latestTs DESC
           LIMIT ? OFFSET ?`
        )
        .all(since, marketIdFilter, limit, offset))
    : (database
        .prepare(
          `SELECT marketId,
                  COUNT(*) AS boostCount,
                  SUM(CAST(COALESCE(userPaid, 0) AS INTEGER)) AS userPaidMicros,
                  SUM(CAST(COALESCE(subsidyUsed, 0) AS INTEGER)) AS subsidyUsedMicros,
                  SUM(CAST(COALESCE(actualCost, 0) AS INTEGER)) AS actualCostMicros,
                  MAX(ts) AS latestTs
           FROM sponsored_locks
           WHERE ts >= ?
           GROUP BY marketId
           ORDER BY latestTs DESC
           LIMIT ? OFFSET ?`
        )
        .all(since, limit, offset));

  const data = (rows as Array<{
    marketId: string;
    boostCount: number | null;
    userPaidMicros: number | string | null;
    subsidyUsedMicros: number | string | null;
    actualCostMicros: number | string | null;
    latestTs: number | null;
  }>).map((row) => ({
    marketId: row.marketId,
    boostCount: row.boostCount ?? 0,
    userPaid: toMicrosString(row.userPaidMicros),
    subsidyUsed: toMicrosString(row.subsidyUsedMicros),
    actualCost: toMicrosString(row.actualCostMicros),
    latestTs: row.latestTs ?? null
  }));

  return NextResponse.json({ chainId: 8453, range, marketId: marketIdFilter, limit, offset, rows: data });
}
