import { getDatabase } from "@/lib/db";

export type MarketSummary = {
  marketId: string;
  creator: string;
  oracle: string;
  surplusRecipient: string;
  questionId: string;
  createdAt: number;
  outcomeNames: string[];
  metadata: string | null;
  latestPrices: string[];
  latestPriceUpdatedAt: number | null;
  usdcFlow24h: string;
  creatorDisplayName: string | null;
  creatorXHandle: string | null;
};

export type MarketDetail = {
  market: {
    marketId: string;
    creator: string;
    oracle: string;
    surplusRecipient: string;
    questionId: string;
    createdAt: number;
    outcomeNames: string[];
    metadata: string | null;
    creatorDisplayName: string | null;
    creatorXHandle: string | null;
  };
  latestPrices: string[];
  latestPriceUpdatedAt: number | null;
  impact: { usdcClip: string; deltaProb: number; ts: number }[];
};

export type VaultEvent = {
  ts: number;
  marketId: string;
  user: string;
  type: string;
  payload: Record<string, unknown>;
  displayName: string | null;
  xHandle: string | null;
};

export type RewardEvent = {
  ts: number;
  kind: string;
  epochId: string;
  user: string | null;
  amount: string | null;
  root: string | null;
  displayName: string | null;
  xHandle: string | null;
};

function parseOutcomeNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch (error) {
    console.error("failed to parse outcome names", error);
    return [];
  }
}

export function loadMarkets(): MarketSummary[] {
  const db = getDatabase();
  const markets = db
    .prepare(
      `SELECT m.marketId,
              m.creator,
              m.oracle,
              m.surplusRecipient,
              m.questionId,
              m.outcomeNames,
              m.metadata,
              m.createdAt,
              p.display_name AS creatorDisplayName,
              p.x_handle AS creatorXHandle
       FROM markets m
       LEFT JOIN profiles p ON lower(p.address) = lower(m.creator)
       ORDER BY createdAt DESC`
    )
    .all() as {
    marketId: string;
    creator: string;
    oracle: string;
    surplusRecipient: string;
    questionId: string;
    outcomeNames: string;
    metadata: string | null;
    createdAt: number;
    creatorDisplayName: string | null;
    creatorXHandle: string | null;
  }[];

  const latestPriceStmt = db.prepare(`SELECT pricesJson, ts FROM prices WHERE marketId = ? ORDER BY ts DESC LIMIT 1`);
  const tradesStmt = db.prepare(`SELECT usdcIn, usdcOut FROM trades WHERE ts >= ? AND marketId = ?`);
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;

  return markets.map((market) => {
    const priceRow = latestPriceStmt.get(market.marketId) as { pricesJson: string; ts: number } | undefined;
    const latestPrices = priceRow ? (JSON.parse(priceRow.pricesJson) as string[]) : [];

    const trades = tradesStmt.all(cutoff, market.marketId) as { usdcIn: string; usdcOut: string }[];
    let flow = 0n;
    for (const trade of trades) {
      flow += BigInt(trade.usdcIn) + BigInt(trade.usdcOut);
    }

    return {
      marketId: market.marketId,
      creator: market.creator,
      oracle: market.oracle,
      surplusRecipient: market.surplusRecipient,
      questionId: market.questionId,
      createdAt: market.createdAt,
      outcomeNames: parseOutcomeNames(market.outcomeNames),
      metadata: market.metadata,
      latestPrices,
      latestPriceUpdatedAt: priceRow?.ts ?? null,
      usdcFlow24h: flow.toString(),
      creatorDisplayName: market.creatorDisplayName,
      creatorXHandle: market.creatorXHandle
    };
  });
}

export function loadMarketDetail(marketId: string): MarketDetail | null {
  const db = getDatabase();
  const id = marketId.toLowerCase();
  const market = db
    .prepare(
      `SELECT m.marketId,
              m.creator,
              m.oracle,
              m.surplusRecipient,
              m.questionId,
              m.outcomeNames,
              m.metadata,
              m.createdAt,
              p.display_name AS creatorDisplayName,
              p.x_handle AS creatorXHandle
       FROM markets m
       LEFT JOIN profiles p ON lower(p.address) = lower(m.creator)
       WHERE m.marketId = ?`
    )
    .get(id) as
    | {
        marketId: string;
        creator: string;
        oracle: string;
        surplusRecipient: string;
        questionId: string;
        outcomeNames: string;
        metadata: string | null;
        createdAt: number;
        creatorDisplayName: string | null;
        creatorXHandle: string | null;
      }
    | undefined;

  if (!market) return null;

  const priceRow = db
    .prepare(`SELECT pricesJson, ts FROM prices WHERE marketId = ? ORDER BY ts DESC LIMIT 1`)
    .get(id) as { pricesJson: string; ts: number } | undefined;

  const impactRows = db
    .prepare(`SELECT usdcClip, deltaProb, ts FROM impact WHERE marketId = ? ORDER BY CAST(usdcClip AS INTEGER)`)
    .all(id) as { usdcClip: string; deltaProb: number; ts: number }[];

  return {
    market: {
      marketId: market.marketId,
      creator: market.creator,
      oracle: market.oracle,
      surplusRecipient: market.surplusRecipient,
      questionId: market.questionId,
      createdAt: market.createdAt,
      outcomeNames: parseOutcomeNames(market.outcomeNames),
      metadata: market.metadata,
      creatorDisplayName: market.creatorDisplayName,
      creatorXHandle: market.creatorXHandle
    },
    latestPrices: priceRow ? (JSON.parse(priceRow.pricesJson) as string[]) : [],
    latestPriceUpdatedAt: priceRow?.ts ?? null,
    impact: impactRows
  };
}

export function loadVaultEvents(limit = 50): VaultEvent[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT l.ts,
              l.marketId,
              l.user,
              l.type,
              l.payloadJson,
              p.display_name AS displayName,
              p.x_handle AS xHandle
       FROM locks l
       LEFT JOIN profiles p ON lower(p.address) = lower(l.user)
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(limit) as {
      ts: number;
      marketId: string;
      user: string;
      type: string;
      payloadJson: string;
      displayName: string | null;
      xHandle: string | null;
    }[];

  return rows.map((row) => ({
    ts: row.ts,
    marketId: row.marketId,
    user: row.user,
    type: row.type,
    payload: JSON.parse(row.payloadJson) as Record<string, unknown>,
    displayName: row.displayName,
    xHandle: row.xHandle
  }));
}

export function loadRewardEvents(limit = 50): RewardEvent[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT r.ts,
              r.kind,
              r.epochId,
              r.user,
              r.amount,
              r.root,
              p.display_name AS displayName,
              p.x_handle AS xHandle
       FROM rewards r
       LEFT JOIN profiles p ON lower(p.address) = lower(r.user)
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(limit) as {
    ts: number;
    kind: string;
    epochId: string;
    user: string | null;
    amount: string | null;
    root: string | null;
    displayName: string | null;
    xHandle: string | null;
  }[];

  return rows.map((row) => ({
    ts: row.ts,
    kind: row.kind,
    epochId: row.epochId,
    user: row.user,
    amount: row.amount,
    root: row.root,
    displayName: row.displayName,
    xHandle: row.xHandle
  }));
}
