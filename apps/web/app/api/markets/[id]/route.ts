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

export async function GET(_request: Request, context: RouteContext) {
  const marketIdParam = context.params.id?.toLowerCase();
  if (!marketIdParam) {
    return NextResponse.json({ error: "missing_market_id" }, { status: 400 });
  }

  const database = db();
  const marketRow = database
    .prepare(
      `SELECT marketId, creator, oracle, surplusRecipient, questionId, outcomeNames, metadata, txHash, createdAt
       FROM markets
       WHERE lower(marketId) = ?`
    )
    .get(marketIdParam) as
    | {
        marketId: string;
        creator: string | null;
        oracle: string | null;
        surplusRecipient: string | null;
        questionId: string | null;
        outcomeNames: string | null;
        metadata: string | null;
        txHash: string | null;
        createdAt: number | null;
      }
    | undefined;

  if (!marketRow) {
    return NextResponse.json({ chainId: 8453, error: "market_not_found" }, { status: 404 });
  }

  const stateRow = database
    .prepare(
      `SELECT totalUsdc, totalQ, alpha, ts
       FROM market_state
       WHERE marketId = ?
       ORDER BY ts DESC
       LIMIT 1`
    )
    .get(marketRow.marketId) as { totalUsdc: string | null; totalQ: string | null; alpha: string | null; ts: number | null } | undefined;

  const resolutionRow = database
    .prepare(
      `SELECT surplus, payoutJson, ts
       FROM resolutions
       WHERE marketId = ?`
    )
    .get(marketRow.marketId) as { surplus: string | null; payoutJson: string | null; ts: number | null } | undefined;

  const statsRow = database
    .prepare(
      `SELECT COUNT(*) AS trades,
              SUM(CAST(usdcIn AS INTEGER)) AS volumeIn,
              SUM(CAST(usdcOut AS INTEGER)) AS volumeOut,
              MAX(ts) AS lastTradeTs
       FROM trades
       WHERE marketId = ?`
    )
    .get(marketRow.marketId) as { trades: number | null; volumeIn: number | string | null; volumeOut: number | string | null; lastTradeTs: number | null } | undefined;

  const locksRow = database
    .prepare(
      `SELECT COUNT(*) AS totalLocks
       FROM locks
       WHERE marketId = ?`
    )
    .get(marketRow.marketId) as { totalLocks: number | null } | undefined;

  return NextResponse.json({
    chainId: 8453,
    market: {
      marketId: marketRow.marketId,
      creator: marketRow.creator,
      oracle: marketRow.oracle,
      surplusRecipient: marketRow.surplusRecipient,
      questionId: marketRow.questionId,
      outcomeNames: marketRow.outcomeNames ? JSON.parse(marketRow.outcomeNames) : [],
      metadata: marketRow.metadata,
      txHash: marketRow.txHash,
      createdAt: marketRow.createdAt ?? null
    },
    state: stateRow
      ? {
          ts: stateRow.ts ?? null,
          totalUsdc: toMicrosString(stateRow.totalUsdc),
          totalQ: toMicrosString(stateRow.totalQ),
          alpha: toMicrosString(stateRow.alpha)
        }
      : null,
    resolution: resolutionRow
      ? {
          ts: resolutionRow.ts ?? null,
          surplus: toMicrosString(resolutionRow.surplus),
          payout: resolutionRow.payoutJson ? (JSON.parse(resolutionRow.payoutJson) as string[]) : []
        }
      : null,
    stats: {
      trades: statsRow?.trades ?? 0,
      volumeIn: toMicrosString(statsRow?.volumeIn),
      volumeOut: toMicrosString(statsRow?.volumeOut),
      lastTradeTs: statsRow?.lastTradeTs ?? null,
      lockEvents: locksRow?.totalLocks ?? 0
    }
  });
}
