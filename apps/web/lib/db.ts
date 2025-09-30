import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { Buffer } from "buffer";
import fs from "fs";
import path from "path";
import { gunzipSync } from "node:zlib";

import { analyzeMarketHeuristics, type MarketHeuristics } from "./heuristics";
import { resolveIdentity, shortenAddress } from "@/lib/identity";
import type { MetricKey } from "@/lib/metrics";
import { ensureRange, RANGE_DEFAULT, type RangeKey } from "@/lib/range";
import { fetchIndexerJson } from "@/lib/indexer";

const DB_PATH =
  process.env.SQLITE_PATH ?? process.env.BK_DB ?? process.env.DATABASE_PATH ?? "../../data/context-edge.db";
const ME_ADDRESS = process.env.BK_ME?.toLowerCase() ?? null;

export type GlobalSearchResult = {
  type: "market" | "wallet";
  id: string;
  title: string;
  subtitle?: string;
  score: number;
};

export type SavedView = {
  id: string;
  label: string;
  query?: string;
  filters?: Record<string, unknown>;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export function normalizeSavedViewQuery(query?: string | null): string {
  if (!query) return "";
  const trimmed = query.startsWith("?") ? query.slice(1) : query;
  if (!trimmed) return "";
  const params = new URLSearchParams(trimmed);
  const map = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(value);
  }
  const normalized = new URLSearchParams();
  const keys = Array.from(map.keys()).sort();
  for (const key of keys) {
    const values = map.get(key)!;
    values.sort();
    for (const value of values) {
      normalized.append(key, value);
    }
  }
  return normalized.toString();
}

let singleton: BetterSqliteDatabase | null = null;

function resolveDatabasePath() {
  return path.isAbsolute(DB_PATH) ? DB_PATH : path.resolve(process.cwd(), DB_PATH);
}

export function getDatabase(): BetterSqliteDatabase {
  if (singleton) return singleton;
  const dbPath = resolveDatabasePath();
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    throw new Error(`Database directory missing: ${dir}`);
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`SQLite database not found at ${dbPath}. Did the indexer run yet?`);
  }
  singleton = new Database(dbPath, { readonly: true, fileMustExist: true });
  return singleton;
}

export function db(): BetterSqliteDatabase {
  return getDatabase();
}

function withWriteDatabase<T>(fn: (database: BetterSqliteDatabase) => T): T {
  const dbPath = resolveDatabasePath();
  const writable = new Database(dbPath, { readonly: false, fileMustExist: true });
  try {
    return fn(writable);
  } finally {
    writable.close();
  }
}

export function hasTable(name: string): boolean {
  const row = db()
    .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1")
    .get(name);
  return !!row;
}

export function cutoff(range?: string | RangeKey): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  const normalized = ensureRange(range ?? RANGE_DEFAULT);
  switch (normalized) {
    case "24h":
      return nowSec - day;
    case "7d":
      return nowSec - 7 * day;
    case "30d":
    default:
      return nowSec - 30 * day;
  }
}

function rangeWindowSeconds(range?: string | RangeKey): number {
  const normalized = ensureRange(range ?? RANGE_DEFAULT);
  switch (normalized) {
    case "24h":
      return 24 * 60 * 60;
    case "7d":
      return 7 * 24 * 60 * 60;
    case "30d":
    default:
      return 30 * 24 * 60 * 60;
  }
}

function microsToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value / 1_000_000;
  if (typeof value === "bigint") return Number(value) / 1_000_000;
  if (typeof value === "string") {
    try {
      return Number(BigInt(value)) / 1_000_000;
    } catch (error) {
      return parseFloat(value) || 0;
    }
  }
  return 0;
}

function dollars(value: number): number {
  return Number(value.toFixed(2));
}

function formatUsd(value: number): string {
  return `$${value.toFixed(0)}`;
}

function sumPayloadAmounts(payloadJson: string): bigint {
  try {
    const parsed = JSON.parse(payloadJson ?? '[]');
    return aggregateAmounts(parsed);
  } catch (error) {
    return 0n;
  }
}

function parseSponsoredAmount(payloadJson: string | null): bigint {
  if (!payloadJson) return 0n;
  try {
    const parsed = JSON.parse(payloadJson);
    if (parsed?.actualCost != null) {
      return BigInt(String(parsed.actualCost));
    }
    let total = 0n;
    if (parsed?.userPaid != null) {
      total += BigInt(String(parsed.userPaid));
    }
    if (parsed?.subsidyUsed != null) {
      total += BigInt(String(parsed.subsidyUsed));
    }
    return total;
  } catch (error) {
    return 0n;
  }
}

function parseUnlockedAmount(payloadJson: string | null): bigint {
  if (!payloadJson) return 0n;
  try {
    const parsed = JSON.parse(payloadJson);
    const amounts = Array.isArray(parsed?.amounts) ? parsed.amounts : [];
    return amounts.reduce((total: bigint, value: unknown) => {
      try {
        return total + BigInt(String(value));
      } catch (error) {
        return total;
      }
    }, 0n);
  } catch (error) {
    return 0n;
  }
}

function aggregateAmounts(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return 0n;
    try {
      return BigInt(trimmed);
    } catch (error) {
      return 0n;
    }
  }
  if (Array.isArray(value)) {
    return value.reduce<bigint>((acc, entry) => acc + aggregateAmounts(entry), 0n);
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    let total = 0n;
    if (Array.isArray(obj.amounts)) {
      total += aggregateAmounts(obj.amounts);
    }
    const candidateKeys = ['total', 'userPaid', 'subsidyUsed', 'actualCost', 'setsAmount', 'boost', 'boostAmount'];
    for (const key of candidateKeys) {
      if (key in obj) {
        total += aggregateAmounts(obj[key]);
      }
    }
    return total;
  }
  return 0n;
}

function rangeCutoff(range: LeaderboardRange | string): number {
  return cutoff(range);
}

export type LeaderboardBucket = "total" | "creator" | "booster" | "trader" | "efficiency";
export type LeaderboardRange = RangeKey;

export type LeaderboardRow = {
  addr: string;
  name: string;
  xHandle: string | null;
  reward: number;
  rewardCreator: number;
  rewardBooster: number;
  rewardTrader: number;
  efficiency: number;
  marketsTouched: number;
  recentRewardTs: number | null;
  lastSeen: number | null;
};

export function getLeaderboard(range: LeaderboardRange, bucket: LeaderboardBucket): LeaderboardRow[] {
  const db = getDatabase();
  const cutoff = rangeCutoff(range);

  const rewardRows = db
    .prepare(
      `SELECT lower(user) AS addr,
              SUM(CASE WHEN kind = 'claim' THEN CAST(amount AS INTEGER) ELSE 0 END) AS reward,
              MAX(CASE WHEN kind = 'claim' THEN ts ELSE NULL END) AS last_ts
       FROM rewards
       WHERE user IS NOT NULL AND ts >= ?
       GROUP BY addr`
    )
    .all(cutoff) as { addr: string; reward: number; last_ts: number | null }[];

  const stakeRows = db
    .prepare(
      `SELECT lower(trader) AS addr,
              SUM(CAST(usdcIn AS INTEGER)) AS stake,
              COUNT(DISTINCT marketId) AS markets
       FROM trades
       WHERE trader IS NOT NULL AND ts >= ?
       GROUP BY addr`
    )
    .all(cutoff) as { addr: string; stake: number | null; markets: number }[];

  const profileStmt = db.prepare(
    `SELECT display_name AS displayName, x_handle AS xHandle, last_seen AS lastSeen
     FROM profiles
     WHERE lower(address) = ?`
  );

  const bucketRows = db
    .prepare(
      `SELECT lower(user) AS addr,
              kind,
              SUM(CAST(amount AS INTEGER)) AS reward
       FROM rewards
       WHERE user IS NOT NULL AND kind IN ('creator', 'booster', 'trader') AND ts >= ?
       GROUP BY addr, kind`
    )
    .all(cutoff) as { addr: string; kind: string; reward: number | null }[];

  const bucketMap = new Map<string, { creator: number; booster: number; trader: number }>();
  for (const row of bucketRows) {
    const key = row.addr;
    const entry = bucketMap.get(key) ?? { creator: 0, booster: 0, trader: 0 };
    const rewardValue = microsToNumber(row.reward ?? 0);
    switch ((row.kind ?? "").toLowerCase()) {
      case "creator":
        entry.creator += rewardValue;
        break;
      case "booster":
        entry.booster += rewardValue;
        break;
      case "trader":
        entry.trader += rewardValue;
        break;
      default:
        break;
    }
    bucketMap.set(key, entry);
  }

  const stakeMap = new Map<string, { stake: number; markets: number }>();
  for (const row of stakeRows) {
    stakeMap.set(row.addr, {
      stake: row.stake ?? 0,
      markets: row.markets ?? 0
    });
  }

  const results: LeaderboardRow[] = rewardRows
    .map((row) => {
    const profile = profileStmt.get(row.addr) as { displayName: string | null; xHandle: string | null; lastSeen: number | null } | undefined;
    const stakeInfo = stakeMap.get(row.addr) ?? { stake: 0, markets: 0 };
    const rewardMicro = row.reward ?? 0;
    const rewardDollars = rewardMicro / 1_000_000;
    const stakeDollars = (stakeInfo.stake ?? 0) / 1_000_000;
    const efficiency = stakeDollars > 0 ? rewardDollars / stakeDollars : rewardDollars > 0 ? rewardDollars : 0;
    const handle = profile?.xHandle?.trim()?.replace(/^@+/, "") || null;
    const primaryName = resolveIdentity({
      address: row.addr,
      displayName: profile?.displayName ?? null,
      xHandle: handle
    });
      const buckets = bucketMap.get(row.addr) ?? { creator: 0, booster: 0, trader: 0 };
      return {
        addr: row.addr,
        name: primaryName,
        xHandle: handle,
        reward: rewardDollars,
        rewardCreator: buckets.creator,
        rewardBooster: buckets.booster,
        rewardTrader: buckets.trader,
        efficiency,
        marketsTouched: stakeInfo.markets ?? 0,
        recentRewardTs: row.last_ts ?? null,
        lastSeen: profile?.lastSeen ?? null
      };
    })
    .sort((a, b) => {
      const key =
        bucket === "efficiency"
          ? b.efficiency - a.efficiency
          : bucket === "creator"
          ? b.rewardCreator - a.rewardCreator
          : bucket === "booster"
          ? b.rewardBooster - a.rewardBooster
          : bucket === "trader"
          ? b.rewardTrader - a.rewardTrader
          : b.reward - a.reward;
      if (key !== 0) return key;
      if ((b.marketsTouched ?? 0) !== (a.marketsTouched ?? 0)) return (b.marketsTouched ?? 0) - (a.marketsTouched ?? 0);
      return (b.recentRewardTs ?? 0) - (a.recentRewardTs ?? 0);
    })
    .slice(0, 100);

  return results;
}

export type SlatePricePoint = { ts: number; prices: number[] };
export type SlateTvlPoint = { ts: number; tvl: number };
export type EdgeBreakdown = {
  boost: number;
  volume: number;
  traders: number;
  cutoffWindow: number;
};

export type SlateItem = {
  marketId: string;
  title: string;
  cutoffTs: number;
  createdAt: number | null;
  boostTotal: number;
  volumeRange: number;
  uniqueTraders: number;
  edgeScore: number;
  edgeBreakdown: EdgeBreakdown;
  tvl: number;
  depth: number;
  oracle: string | null;
  surplusRecipient: string | null;
  questionId: string | null;
  outcomes: string[];
  lastPrices: number[];
  priceSeries: SlatePricePoint[];
  tvlSeries: SlateTvlPoint[];
  costToMove: {
    usdc: number;
    deltaProb: number;
    costPerPoint: number | null;
  } | null;
  heuristics: {
    clarity: number;
    ambiguousTerms: string[];
    vagueCount: number;
    sourceCount: number;
    sourceDomains: number;
    sourceParity: number;
    settlementScore: number;
    warnings: string[];
  } | null;
  category?: string | null;
};

export type ActionQueueItem = {
  marketId: string;
  title: string;
  action: "create" | "boost" | "bet" | "claim";
  rationale: string;
  score: number;
  hoursToCutoff: number;
  edgeScore: number;
  boostTotal: number;
  boostTarget: number;
  boostGap: number;
  tvl: number;
  costToMove?: number | null;
  clarityScore?: number | null;
  claimable?: number | null;
  ctaHref?: string;
};

export type LiquidityHoleItem = {
  marketId: string;
  title: string;
  boostTotal: number;
  boostTarget: number;
  boostGap: number;
  tvl: number;
  edgeScore: number;
  hoursToCutoff: number;
  costToMove?: number | null;
};

export type MarketTableRow = {
  marketId: string;
  title: string;
  category: string | null;
  priceYes: number | null;
  tvl: number;
  spread: number | null;
  costToMove: number | null;
  cutoffTs: number;
  sparkline: number[];
  boostTotal: number;
  volumeRange: number;
  createdAt: number | null;
};

export function getLiveSlate(range: RangeKey = RANGE_DEFAULT, limit = 20): SlateItem[] {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const since = cutoff(range);

  const marketRows = db
    .prepare(
      `SELECT marketId, metadata, outcomeNames, oracle, surplusRecipient, questionId, createdAt
       FROM markets`
    )
    .all() as {
      marketId: string;
      metadata: string | null;
      outcomeNames: string | null;
      oracle: string | null;
      surplusRecipient: string | null;
      questionId: string | null;
      createdAt: number | null;
    }[];

  const tradeRows = db
    .prepare(
      `SELECT marketId, SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS volume,
              COUNT(DISTINCT trader) AS traders
       FROM trades
       WHERE ts >= ?
       GROUP BY marketId`
    )
    .all(since) as { marketId: string; volume: number | null; traders: number | null }[];

  const latestStateRows = db
    .prepare(
      `SELECT marketId, totalUsdc, totalQ
       FROM market_state
       WHERE id IN (SELECT MAX(id) FROM market_state GROUP BY marketId)`
    )
    .all() as { marketId: string; totalUsdc: string; totalQ: string }[];

  const volumeMap = new Map<string, { volume: number; traders: number }>();
  for (const row of tradeRows) {
    volumeMap.set(row.marketId, {
      volume: row.volume ?? 0,
      traders: row.traders ?? 0
    });
  }

  const boostMap = computeBoostBalances(db);

  const tvlMap = new Map<string, { totalUsdc: number; totalQ: number }>();
  for (const row of latestStateRows) {
    tvlMap.set(row.marketId, {
      totalUsdc: microsToNumber(row.totalUsdc),
      totalQ: microsToNumber(row.totalQ)
    });
  }

  const baseItems = marketRows.map((market) => {
    const meta = interpretMetadata(market.metadata);
    const heuristics = meta.heuristics;
    const heuristicsSummary = heuristics
      ? {
          clarity: heuristics.rule.clarityScore,
          ambiguousTerms: heuristics.rule.ambiguousTerms,
          vagueCount: heuristics.rule.vaguePhraseCount,
          sourceCount: heuristics.sources.urls.length,
          sourceDomains: heuristics.sources.domains.length,
          sourceParity: heuristics.sources.parityScore,
          settlementScore: heuristics.settlement.score,
          warnings: heuristics.settlement.warnings
        }
      : null;
    const title = meta.title ?? market.marketId;
    const volumeInfo = volumeMap.get(market.marketId) ?? { volume: 0, traders: 0 };
    const boostEntry = boostMap.get(market.marketId) ?? { sponsored: 0n, unlocked: 0n };
    const outstanding = boostEntry.sponsored > boostEntry.unlocked ? boostEntry.sponsored - boostEntry.unlocked : 0n;
    const boostTotal = Number(outstanding) / 1_000_000;
    const volumeRange = (volumeInfo.volume ?? 0) / 1_000_000;
    const uniqueTraders = volumeInfo.traders ?? 0;
    const fallbackCutoff = (market.createdAt ?? now) + 72 * 3600;
    const cutoffCandidate = meta.cutoffTs ?? null;
    const cutoffTs = cutoffCandidate && cutoffCandidate > 0 ? cutoffCandidate : fallbackCutoff;
    const cutoffMultiplier = cutoffWeight(cutoffTs, now);
    const boostComponent = boostTotal * 0.4;
    const volumeComponent = volumeRange * 0.4;
    const traderComponent = uniqueTraders * 0.2;
    const edgeScore = (boostComponent + volumeComponent + traderComponent) * cutoffMultiplier;
    const edgeBreakdown: EdgeBreakdown = {
      boost: Number(boostComponent.toFixed(3)),
      volume: Number(volumeComponent.toFixed(3)),
      traders: Number(traderComponent.toFixed(3)),
      cutoffWindow: Number(cutoffMultiplier.toFixed(3))
    };
    const state = tvlMap.get(market.marketId) ?? { totalUsdc: 0, totalQ: 0 };
    return {
      marketId: market.marketId,
      title,
      cutoffTs,
      createdAt: market.createdAt ?? null,
      boostTotal,
      volumeRange,
      uniqueTraders,
      edgeScore,
      edgeBreakdown,
      tvl: state.totalUsdc,
      depth: state.totalQ,
      oracle: market.oracle ?? null,
      surplusRecipient: market.surplusRecipient ?? null,
      questionId: market.questionId ?? null,
      outcomes: parseOutcomeNames(market.outcomeNames),
      lastPrices: [] as number[],
      priceSeries: [] as SlatePricePoint[],
      tvlSeries: [] as SlateTvlPoint[],
      costToMove: null as SlateItem["costToMove"],
      heuristics: heuristicsSummary,
      category: meta.category ?? null
    } satisfies SlateItem;
  });

  const ordered = baseItems.sort((a, b) => b.edgeScore - a.edgeScore);
  const selected = typeof limit === "number" ? ordered.slice(0, limit) : ordered;

  const priceStmt = db.prepare(
    `SELECT ts, pricesJson
     FROM prices
     WHERE marketId = ?
     ORDER BY ts DESC
     LIMIT 24`
  );

  const tvlHistoryStmt = db.prepare(
    `SELECT ts, totalUsdc
     FROM market_state
     WHERE marketId = ?
     ORDER BY ts DESC
     LIMIT 24`
  );

  const impactStmt = db.prepare(
    `SELECT usdcClip, deltaProb
     FROM impact
     WHERE marketId = ?
     ORDER BY ts DESC
     LIMIT 1`
  );

  for (const item of selected) {
    const priceRows = priceStmt.all(item.marketId) as { ts: number; pricesJson: string }[];
    const priceSeries = priceRows
      .map((row) => ({ ts: row.ts, prices: parsePriceVector(row.pricesJson) }))
      .reverse();
    const lastPrices = priceSeries.length > 0 ? priceSeries[priceSeries.length - 1].prices : [];

    const tvlRows = tvlHistoryStmt.all(item.marketId) as { ts: number; totalUsdc: string }[];
    const tvlSeries = tvlRows
      .map((row) => ({ ts: row.ts, tvl: microsToNumber(row.totalUsdc) }))
      .reverse();

    const impactRow = impactStmt.get(item.marketId) as { usdcClip: string | null; deltaProb: number | null } | undefined;
    let costToMove: SlateItem["costToMove"] = null;
    if (impactRow) {
      const usdc = microsToNumber(impactRow.usdcClip ?? 0);
      const deltaProb = Number(impactRow.deltaProb ?? 0);
      const costPerPoint = deltaProb > 0 ? Number((usdc * (0.01 / deltaProb)).toFixed(2)) : null;
      costToMove = {
        usdc: Number(usdc.toFixed(2)),
        deltaProb,
        costPerPoint
      };
    }

    item.priceSeries = priceSeries;
    item.lastPrices = lastPrices;
    item.tvlSeries = tvlSeries;
    item.costToMove = costToMove;
  }

  return selected;
}

export function getMarketsTable(range: RangeKey = RANGE_DEFAULT, limit = 200): MarketTableRow[] {
  const slate = getLiveSlate(range, limit);
  return slate
    .map((item) => {
      const sparkline = item.priceSeries
        .map((point) => point.prices?.[0])
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        .map((value) => Number(value.toFixed(4)));
      const priceYesRaw = item.lastPrices?.[0] ?? (sparkline.length > 0 ? sparkline[sparkline.length - 1] : null);
      if (sparkline.length === 0 && typeof priceYesRaw === "number") {
        sparkline.push(Number(priceYesRaw.toFixed(4)));
      }
      const spread = item.costToMove?.deltaProb != null ? Number(item.costToMove.deltaProb.toFixed(4)) : null;
      const costToMove = item.costToMove?.costPerPoint ?? item.costToMove?.usdc ?? null;
      return {
        marketId: item.marketId,
        title: item.title,
        category: item.category ?? null,
        priceYes: priceYesRaw != null ? Number(priceYesRaw.toFixed(4)) : null,
        tvl: Number(item.tvl.toFixed(2)),
        spread,
        costToMove: costToMove != null ? Number(costToMove.toFixed(2)) : null,
        cutoffTs: item.cutoffTs,
        sparkline,
        boostTotal: Number(item.boostTotal.toFixed(2)),
        volumeRange: Number(item.volumeRange.toFixed(2)),
        createdAt: item.createdAt ?? null
      } satisfies MarketTableRow;
    })
    .sort((a, b) => b.tvl - a.tvl);
}

export async function getActionQueue(range: RangeKey = RANGE_DEFAULT, limit = 5): Promise<ActionQueueItem[]> {
  const now = Math.floor(Date.now() / 1000);
  const slate = getLiveSlate(range, 120);
  if (slate.length === 0) return [];

  const BOOST_TARGET = 2500;
  const candidates = slate.map((item) => {
    const hoursToCutoff = Math.max(0.25, (item.cutoffTs - now) / 3600);
    const boostGap = Math.max(0, BOOST_TARGET - item.boostTotal);
    const ev = Math.max(0, item.edgeScore);
    const urgency = Math.max(0, 72 - hoursToCutoff);
    const liquidity = boostGap;
    return { item, hoursToCutoff, boostGap, ev, urgency, liquidity };
  });

  const maxEv = Math.max(...candidates.map((entry) => entry.ev), 0);
  const maxUrgency = Math.max(...candidates.map((entry) => entry.urgency), 0);
  const maxLiquidity = Math.max(...candidates.map((entry) => entry.liquidity), 0);

  const scored = candidates.map(({ item, hoursToCutoff, boostGap, ev, urgency, liquidity }) => {
    const score = computeActionScore(ev, maxEv, urgency, maxUrgency, liquidity, maxLiquidity);

    const isFresh = item.createdAt != null ? now - item.createdAt < 12 * 3600 : false;
    let action: ActionQueueItem["action"] = "bet";
    let rationale = `Edge ${item.edgeScore.toFixed(1)} with ${formatUsd(item.tvl)} TVL.`;
    let ctaHref = `https://context.markets/markets/${item.marketId}`;

    if (isFresh && item.tvl < 500) {
      action = "create";
      rationale = "Market just launched with thin liquidity. Spin up the opening book.";
      ctaHref = "https://context.markets/create";
    } else if (boostGap > BOOST_TARGET * 0.3) {
      action = "boost";
      rationale = `Short $${boostGap.toFixed(0)} vs $${BOOST_TARGET.toFixed(0)} liquidity target.`;
    } else if (ev >= 25) {
      action = "bet";
      rationale = `Edge ${ev.toFixed(1)} and ${item.volumeRange.toFixed(0)} volume this range.`;
    } else if (item.costToMove?.costPerPoint != null && item.costToMove.costPerPoint > 0) {
      action = "boost";
      rationale = `Cost to move 1pt is ${formatUsd(item.costToMove.costPerPoint)}. Tighten spread.`;
    }

    return {
      marketId: item.marketId,
      title: item.title,
      action,
      rationale,
      score,
      hoursToCutoff: Number(hoursToCutoff.toFixed(1)),
      edgeScore: Number(item.edgeScore.toFixed(2)),
      boostTotal: Number(item.boostTotal.toFixed(2)),
      boostTarget: BOOST_TARGET,
      boostGap: Number(boostGap.toFixed(2)),
      tvl: Number(item.tvl.toFixed(2)),
      costToMove: item.costToMove?.costPerPoint ?? item.costToMove?.usdc ?? null,
      clarityScore: item.heuristics?.clarity ?? null,
      ctaHref
    } satisfies ActionQueueItem;
  });

  const claimEntry = await buildClaimAction();
  const combined = claimEntry ? [claimEntry, ...scored] : scored;

  return combined
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function computeActionScore(ev: number, maxEv: number, urgency: number, maxUrgency: number, liquidity: number, maxLiquidity: number): number {
  const normEv = maxEv > 0 ? ev / maxEv : 0;
  const normUrgency = maxUrgency > 0 ? urgency / maxUrgency : 0;
  const normLiquidity = maxLiquidity > 0 ? liquidity / maxLiquidity : 0;
  return Number((0.5 * normEv + 0.3 * normUrgency + 0.2 * normLiquidity).toFixed(4));
}

async function buildClaimAction(): Promise<ActionQueueItem | null> {
  if (!ME_ADDRESS) return null;
  const claimable = await fetchClaimableUsd(ME_ADDRESS);
  if (claimable == null || claimable <= 0) return null;
  const score = Math.min(1, claimable / 500); // cap contribution to keep queue balanced
  return {
    marketId: `claim-${ME_ADDRESS}`,
    title: "Claim outstanding rewards",
    action: "claim",
    rationale: `Claim $${claimable.toFixed(2)} before the epoch closes.`,
    score,
    hoursToCutoff: 0,
    edgeScore: Number(claimable.toFixed(2)),
    boostTotal: 0,
    boostTarget: 0,
    boostGap: 0,
    tvl: 0,
    costToMove: null,
    clarityScore: null,
    claimable: Number(claimable.toFixed(2)),
    ctaHref: "https://context.markets/rewards"
  } satisfies ActionQueueItem;
}

async function fetchClaimableUsd(address: string): Promise<number | null> {
  const base = address.trim().toLowerCase();
  if (!base) return null;
  try {
    const summary = await fetchIndexerJson<{ totals?: { claimable?: string | number } }>(`/rewards/${base}`);
    const raw = summary?.totals?.claimable;
    if (raw == null) return null;
    const value = typeof raw === "string" ? parseFloat(raw) : Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.max(0, value);
  } catch (error) {
    return null;
  }
}

export function getLiquidityHoles(range: RangeKey = RANGE_DEFAULT, limit = 16): LiquidityHoleItem[] {
  const now = Math.floor(Date.now() / 1000);
  const BOOST_TARGET = 2500;
  return getLiveSlate(range, 120)
    .map((item) => {
      const hoursToCutoff = Math.max(0.5, (item.cutoffTs - now) / 3600);
      const boostGap = Math.max(0, BOOST_TARGET - item.boostTotal);
      return {
        marketId: item.marketId,
        title: item.title,
        boostTotal: Number(item.boostTotal.toFixed(2)),
        boostTarget: BOOST_TARGET,
        boostGap: Number(boostGap.toFixed(2)),
        tvl: Number(item.tvl.toFixed(2)),
        edgeScore: Number(item.edgeScore.toFixed(2)),
        hoursToCutoff: Number(hoursToCutoff.toFixed(1)),
        costToMove: item.costToMove?.costPerPoint ?? item.costToMove?.usdc ?? null
      } satisfies LiquidityHoleItem;
    })
    .filter((item) => item.boostGap >= 200)
    .sort((a, b) => {
      const gapDiff = b.boostGap - a.boostGap;
      if (gapDiff !== 0) return gapDiff;
      return a.hoursToCutoff - b.hoursToCutoff;
    })
    .slice(0, limit);
}

export type NearResolutionItem = {
  marketId: string;
  title: string;
  cutoffTs: number;
  tvl: number;
  boostTotal: number;
  costToMove: SlateItem["costToMove"];
};

export function getNearResolution(range: RangeKey = RANGE_DEFAULT): NearResolutionItem[] {
  const now = Math.floor(Date.now() / 1000);
  return getLiveSlate(range, 80)
    .filter((item) => item.cutoffTs >= now && item.cutoffTs <= now + 3 * 86400)
    .sort((a, b) => a.cutoffTs - b.cutoffTs)
    .slice(0, 50)
    .map(({ marketId, title, cutoffTs, tvl, boostTotal, costToMove }) => ({
      marketId,
      title,
      cutoffTs,
      tvl,
      boostTotal,
      costToMove
    }));
}

export type ResolvedMarket = {
  marketId: string;
  title: string;
  resolvedAt: number;
  outcomes: { name: string; payout: number }[];
  surplus: number;
  totalRedeemed: number;
  redeemerCount: number;
};

export function getResolvedMarkets(limit = 12): ResolvedMarket[] {
  const db = getDatabase();
  const resolutionRows = db
    .prepare(
      `SELECT marketId, ts, surplus, payoutJson
       FROM resolutions
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(limit) as { marketId: string; ts: number; surplus: string | null; payoutJson: string | null }[];

  if (resolutionRows.length === 0) return [];

  const marketRows = db
    .prepare(
      `SELECT marketId, metadata, outcomeNames
       FROM markets
       WHERE marketId IN (${resolutionRows.map(() => "?").join(",")})`
    )
    .all(...resolutionRows.map((row) => row.marketId)) as { marketId: string; metadata: string | null; outcomeNames: string | null }[];

  const marketInfo = new Map<string, { title: string; outcomes: string[] }>();
  for (const row of marketRows) {
    const meta = interpretMetadata(row.metadata);
    marketInfo.set(row.marketId, {
      title: meta.title ?? row.marketId,
      outcomes: parseOutcomeNames(row.outcomeNames)
    });
  }

  const redemptionStmt = db.prepare(
    `SELECT SUM(CAST(payout AS INTEGER)) AS total, COUNT(DISTINCT user) AS redeemers
     FROM redemptions
     WHERE marketId = ?`
  );

  const resolved: ResolvedMarket[] = [];
  for (const row of resolutionRows) {
    const info = marketInfo.get(row.marketId) ?? { title: row.marketId, outcomes: [] };
    const payoutValues = parsePayouts(row.payoutJson, info.outcomes.length);
    const outcomes = info.outcomes.length
      ? info.outcomes.map((name, index) => ({ name, payout: payoutValues[index] ?? 0 }))
      : payoutValues.map((value, index) => ({ name: `Outcome ${index + 1}`, payout: value }));

    const redemptionRow = redemptionStmt.get(row.marketId) as { total: number | null; redeemers: number | null } | undefined;
    const totalRedeemed = microsToNumber(redemptionRow?.total ?? 0);
    const redeemerCount = redemptionRow?.redeemers ?? 0;

    resolved.push({
      marketId: row.marketId,
      title: info.title,
      resolvedAt: row.ts,
      outcomes,
      surplus: microsToNumber(row.surplus ?? 0),
      totalRedeemed,
      redeemerCount
    });
  }

  return resolved;
}

export type RewardContributionKind = "create" | "boost" | "trade" | "claim";

export type RewardContribution = {
  kind: RewardContributionKind;
  marketId: string | null;
  marketTitle?: string | null;
  amount: number;
  ts: number;
  txHash?: string | null;
  description?: string;
};

export type RewardSplit = {
  bucket: string;
  reward: number;
  stake: number;
  change?: number;
  contributions: RewardContribution[];
};

export function getMySummary(range: LeaderboardRange): RewardSplit[] {
  if (!ME_ADDRESS) return [];
  const address = ME_ADDRESS;
  const db = getDatabase();
  const cutoff = rangeCutoff(range);
  const windowLength = rangeWindowSeconds(range);
  const previousCutoff = windowLength != null ? cutoff - windowLength : null;

  const rewardStmt = db.prepare(
    `SELECT SUM(CAST(amount AS INTEGER)) AS reward
     FROM rewards
     WHERE lower(user) = ? AND kind = 'claim' AND ts >= ?`
  );
  const totalReward = dollars(microsToNumber((rewardStmt.get(address, cutoff) as { reward: number | null } | undefined)?.reward ?? 0));
  let previousReward = 0;
  if (previousCutoff != null) {
    const prevRewardRow = db
      .prepare(
        `SELECT SUM(CAST(amount AS INTEGER)) AS reward
         FROM rewards
         WHERE lower(user) = ? AND kind = 'claim' AND ts >= ? AND ts < ?`
      )
      .get(address, previousCutoff, cutoff) as { reward: number | null } | undefined;
    previousReward = dollars(microsToNumber(prevRewardRow?.reward ?? 0));
  }

  const stakeStmt = db.prepare(
    `SELECT SUM(CAST(usdcIn AS INTEGER)) AS stake
     FROM trades
     WHERE lower(trader) = ? AND ts >= ?`
  );
  const totalStake = dollars(microsToNumber((stakeStmt.get(address, cutoff) as { stake: number | null } | undefined)?.stake ?? 0));

  const bucketRows = db
    .prepare(
      `SELECT kind, SUM(CAST(amount AS INTEGER)) AS reward
       FROM rewards
       WHERE lower(user) = ? AND kind IN ('creator', 'booster', 'trader') AND ts >= ?
       GROUP BY kind`
    )
    .all(address, cutoff) as { kind: string; reward: number | null }[];

  const bucketRewardMap = new Map<string, number>();
  for (const row of bucketRows) {
    bucketRewardMap.set(row.kind.toUpperCase(), dollars(microsToNumber(row.reward ?? 0)));
  }

  const previousBucketRewardMap = new Map<string, number>();
  if (previousCutoff != null) {
    const prevBucketRows = db
      .prepare(
        `SELECT kind, SUM(CAST(amount AS INTEGER)) AS reward
         FROM rewards
         WHERE lower(user) = ? AND kind IN ('creator', 'booster', 'trader') AND ts >= ? AND ts < ?
         GROUP BY kind`
      )
      .all(address, previousCutoff, cutoff) as { kind: string; reward: number | null }[];
    for (const row of prevBucketRows) {
      previousBucketRewardMap.set(row.kind.toUpperCase(), dollars(microsToNumber(row.reward ?? 0)));
    }
  }

  const creatorContributions = collectCreatorContributions(db, address, cutoff);
  const boosterContributions = collectBoosterContributions(db, address, cutoff);
  const traderContributions = collectTraderContributions(db, address, cutoff);
  const claimContributions = collectClaimContributions(db, address, cutoff);

const splits: RewardSplit[] = [];

  const totalChange = previousCutoff != null ? dollars(totalReward - previousReward) : undefined;
  splits.push({
    bucket: "TOTAL",
    reward: totalReward,
    stake: totalStake,
    change: totalChange,
    contributions: claimContributions
  });

  const bucketDefs: Array<{ key: string; contributions: RewardContribution[]; includeStake?: boolean }> = [
    { key: "CREATOR", contributions: creatorContributions },
    { key: "BOOSTER", contributions: boosterContributions },
    { key: "TRADER", contributions: traderContributions, includeStake: true }
  ];

  for (const def of bucketDefs) {
    const rewardValue = bucketRewardMap.get(def.key) ?? 0;
    const prevValue = previousCutoff != null ? previousBucketRewardMap.get(def.key) ?? 0 : undefined;
    const change = prevValue !== undefined ? dollars(rewardValue - prevValue) : undefined;
    splits.push({
      bucket: def.key,
      reward: rewardValue,
      stake: def.includeStake ? totalStake : 0,
      change,
      contributions: def.contributions
    });
  }

  return splits;
}

let marketTitleStmt: ReturnType<BetterSqliteDatabase["prepare"]> | null = null;
const marketTitleCache = new Map<string, string>();

function lookupMarketTitle(db: BetterSqliteDatabase, marketId: string): string {
  const cached = marketTitleCache.get(marketId);
  if (cached) return cached;
  if (!marketTitleStmt) {
    marketTitleStmt = db.prepare(`SELECT metadata FROM markets WHERE marketId = ?`);
  }
  const row = marketTitleStmt.get(marketId) as { metadata: string | null } | undefined;
  const title = deriveTitle(row?.metadata ?? null) ?? marketId;
  marketTitleCache.set(marketId, title);
  return title;
}

function collectCreatorContributions(db: BetterSqliteDatabase, address: string, cutoff: number): RewardContribution[] {
  const rows = db
    .prepare(
      `SELECT marketId, metadata, createdAt
       FROM markets
       WHERE lower(creator) = ? AND createdAt >= ?
       ORDER BY createdAt DESC
       LIMIT 10`
    )
    .all(address, cutoff) as { marketId: string; metadata: string | null; createdAt: number | null }[];

  return rows.map((row) => ({
    kind: "create" as const,
    marketId: row.marketId,
    marketTitle: deriveTitle(row.metadata) ?? row.marketId,
    amount: 0,
    ts: row.createdAt ?? cutoff,
    description: "Created market"
  }));
}

function collectBoosterContributions(db: BetterSqliteDatabase, address: string, cutoff: number): RewardContribution[] {
  const rows = db
    .prepare(
      `SELECT marketId, ts, actualCost, userPaid, subsidyUsed, txHash
       FROM sponsored_locks
       WHERE lower(user) = ? AND ts >= ?
       ORDER BY ts DESC
       LIMIT 10`
    )
    .all(address, cutoff) as {
      marketId: string;
      ts: number | null;
      actualCost: string | null;
      userPaid: string | null;
      subsidyUsed: string | null;
      txHash: string | null;
    }[];

  return rows.map((row) => {
    const actual = aggregateAmounts(row.actualCost ?? 0);
    const userPaid = aggregateAmounts(row.userPaid ?? 0);
    const subsidy = aggregateAmounts(row.subsidyUsed ?? 0);
    const totalMicros = actual > 0n ? actual : userPaid + subsidy;
    const amount = dollars(Number(totalMicros) / 1_000_000);
    return {
      kind: "boost" as const,
      marketId: row.marketId,
      marketTitle: lookupMarketTitle(db, row.marketId),
      amount,
      ts: row.ts ?? cutoff,
      txHash: row.txHash ?? undefined,
      description: "Boosted liquidity"
    } satisfies RewardContribution;
  });
}

function collectTraderContributions(db: BetterSqliteDatabase, address: string, cutoff: number): RewardContribution[] {
  const rows = db
    .prepare(
      `SELECT marketId, ts, txHash, usdcIn, usdcOut
       FROM trades
       WHERE lower(trader) = ? AND ts >= ?
       ORDER BY ts DESC
       LIMIT 12`
    )
    .all(address, cutoff) as {
      marketId: string;
      ts: number | null;
      txHash: string | null;
      usdcIn: string | null;
      usdcOut: string | null;
    }[];

  return rows.map((row) => {
    const inMicros = aggregateAmounts(row.usdcIn ?? 0);
    const outMicros = aggregateAmounts(row.usdcOut ?? 0);
    const netMicros = inMicros - outMicros;
    const rawAmount = Number(netMicros) / 1_000_000;
    const amount = dollars(rawAmount);
    const description = netMicros >= 0n ? "Bought positions" : "Sold positions";
    return {
      kind: "trade" as const,
      marketId: row.marketId,
      marketTitle: lookupMarketTitle(db, row.marketId),
      amount,
      ts: row.ts ?? cutoff,
      txHash: row.txHash ?? undefined,
      description
    } satisfies RewardContribution;
  });
}

function collectClaimContributions(db: BetterSqliteDatabase, address: string, cutoff: number): RewardContribution[] {
  const rows = db
    .prepare(
      `SELECT tx_hash AS txHash, block_time AS blockTime, amount_usdc AS amount
       FROM reward_claims
       WHERE lower(wallet) = ? AND block_time >= ?
       ORDER BY block_time DESC
       LIMIT 15`
    )
    .all(address, cutoff) as { txHash: string | null; blockTime: number | null; amount: string | null }[];

  return rows.map((row) => ({
    kind: "claim" as const,
    marketId: null,
    amount: dollars(microsToNumber(row.amount ?? 0)),
    ts: row.blockTime ?? cutoff,
    txHash: row.txHash ?? undefined,
    description: "Reward claimed"
  }));
}

function parseOutcomeNames(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => String(entry)).filter((entry) => entry.trim().length > 0);
    }
    return [];
  } catch (error) {
    return [];
  }
}

function parsePriceVector(json: string | null): number[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => microsToNumber(entry));
  } catch (error) {
    return [];
  }
}

function cutoffWeight(cutoffTs: number, now: number): number {
  const remaining = cutoffTs - now;
  if (remaining >= 3600 && remaining <= 7 * 86400) {
    return 1;
  }
  if (remaining <= 0) {
    return 0.4;
  }
  return 0.6;
}

function parsePayouts(json: string | null, expected: number): number[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const payouts = parsed.map((value) => normalizePayout(value));
    if (expected > payouts.length) {
      while (payouts.length < expected) {
        payouts.push(0);
      }
    }
    return payouts;
  } catch (error) {
    return [];
  }
}

function normalizePayout(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const str = typeof value === "string" ? value : String(value);
  if (!str) return 0;
  const float = Number.parseFloat(str);
  if (!Number.isFinite(float)) return 0;
  if (float === 0) return 0;
  if (float > 1) {
    return Number((float / 1_000_000_000_000_000_000).toFixed(4));
  }
  return Number(float.toFixed(4));
}

function collectAddressMarkets(db: BetterSqliteDatabase, address: string, since?: number): Set<string> {
  const markets = new Set<string>();

  const tradeSql = since != null
    ? `SELECT DISTINCT marketId FROM trades WHERE lower(trader) = ? AND ts >= ?`
    : `SELECT DISTINCT marketId FROM trades WHERE lower(trader) = ?`;
  const tradeStmt = db.prepare(tradeSql);
  const tradeRows = since != null
    ? (tradeStmt.all(address, since) as { marketId: string }[])
    : (tradeStmt.all(address) as { marketId: string }[]);
  for (const row of tradeRows) {
    if (row.marketId) markets.add(row.marketId);
  }

  const boostSql = since != null
    ? `SELECT DISTINCT marketId FROM sponsored_locks WHERE lower(user) = ? AND ts >= ?`
    : `SELECT DISTINCT marketId FROM sponsored_locks WHERE lower(user) = ?`;
  const boostStmt = db.prepare(boostSql);
  const boostRows = since != null
    ? (boostStmt.all(address, since) as { marketId: string }[])
    : (boostStmt.all(address) as { marketId: string }[]);
  for (const row of boostRows) {
    if (row.marketId) markets.add(row.marketId);
  }

  const createSql = since != null
    ? `SELECT marketId FROM markets WHERE lower(creator) = ? AND createdAt >= ?`
    : `SELECT marketId FROM markets WHERE lower(creator) = ?`;
  const createStmt = db.prepare(createSql);
  const createRows = since != null
    ? (createStmt.all(address, since) as { marketId: string }[])
    : (createStmt.all(address) as { marketId: string }[]);
  for (const row of createRows) {
    if (row.marketId) markets.add(row.marketId);
  }

  return markets;
}

export function searchContextEntities(query: string, limit = 20): GlobalSearchResult[] {
  const normalized = query.trim();
  if (!normalized) return [];

  const dbInstance = getDatabase();
  const pattern = '%' + normalized.replace(/\s+/g, '%') + '%';
  const limitValue = Math.max(5, Math.min(100, limit * 2));
  const normalizedLower = normalized.toLowerCase();

  const marketRows = dbInstance
    .prepare(
      `SELECT marketId, metadata, createdAt
       FROM markets
       WHERE metadata LIKE ? OR marketId LIKE ?
       ORDER BY createdAt DESC
       LIMIT ?`
    )
    .all(pattern, pattern, limitValue) as { marketId: string; metadata: string | null; createdAt: number | null }[];

  const marketResults: GlobalSearchResult[] = marketRows.map((row) => {
    const meta = interpretMetadata(row.metadata);
    const title = meta.title ?? row.marketId;
    const titleLower = title.toLowerCase();
    let score = 0.5;
    if (titleLower.includes(normalizedLower)) score += 0.25;
    if (row.marketId.toLowerCase().includes(normalizedLower)) score += 0.15;
    if ((meta.sourceUrls?.length ?? 0) > 0) score += 0.05;
    return {
      type: "market",
      id: row.marketId,
      title,
      subtitle: meta.ruleText ?? undefined,
      score: Number(Math.min(1, score).toFixed(3))
    } satisfies GlobalSearchResult;
  });

  const walletRows = dbInstance
    .prepare(
      `SELECT address, display_name AS displayName, x_handle AS xHandle
       FROM profiles
       WHERE display_name LIKE ? OR x_handle LIKE ? OR address LIKE ?
       LIMIT ?`
    )
    .all(pattern, pattern, pattern, limitValue) as { address: string; displayName: string | null; xHandle: string | null }[];

  const walletResults: GlobalSearchResult[] = walletRows.map((row) => {
    const title = row.displayName?.trim() || shortenAddress(row.address);
    const subtitleParts = [] as string[];
    if (row.xHandle) subtitleParts.push(`@${row.xHandle}`);
    subtitleParts.push(shortenAddress(row.address));
    let score = 0.45;
    if ((row.displayName ?? "").toLowerCase().includes(normalizedLower)) score += 0.25;
    if ((row.xHandle ?? "").toLowerCase().includes(normalizedLower.replace(/^@/, ""))) score += 0.2;
    if (row.address.toLowerCase().includes(normalizedLower)) score += 0.1;
    return {
      type: "wallet",
      id: row.address,
      title,
      subtitle: subtitleParts.join(" • "),
      score: Number(Math.min(1, score).toFixed(3))
    } satisfies GlobalSearchResult;
  });

  const combined = [...marketResults, ...walletResults]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return combined;
}

export function getSavedViews(): SavedView[] {
  if (!hasTable("meta")) return [];
  const dbInstance = getDatabase();
  const rows = dbInstance
    .prepare(`SELECT key, value FROM meta WHERE key LIKE 'saved_view:%'`)
    .all() as { key: string; value: string }[];

  const views: SavedView[] = [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.value ?? "{}") as {
        label?: string;
        query?: string;
        filters?: Record<string, unknown>;
        createdAt?: number;
        updatedAt?: number;
      };
      views.push({
        id: row.key.slice("saved_view:".length),
        label: parsed.label ?? row.key.slice("saved_view:".length),
        query: parsed.query,
        filters: parsed.filters,
        createdAt: parsed.createdAt ?? null,
        updatedAt: parsed.updatedAt ?? parsed.createdAt ?? null
      });
    } catch (error) {
      views.push({
        id: row.key.slice("saved_view:".length),
        label: row.key.slice("saved_view:".length),
        createdAt: null,
        updatedAt: null
      });
    }
  }

  return views.sort((a, b) => {
    const aTime = a.updatedAt ?? a.createdAt ?? 0;
    const bTime = b.updatedAt ?? b.createdAt ?? 0;
    return bTime - aTime;
  });
}

type SavedViewPayload = {
  label?: string | null;
  query?: string | null;
  filters?: Record<string, unknown> | null;
};

export function findSavedViewByQuery(query: string | null | undefined, views?: SavedView[]): SavedView | undefined {
  const normalized = normalizeSavedViewQuery(query);
  if (!normalized) return undefined;
  const list = views ?? getSavedViews();
  return list.find((view) => normalizeSavedViewQuery(view.query ?? "") === normalized);
}

export function upsertSavedView(id: string, payload: SavedViewPayload) {
  if (!id || !id.trim()) {
    throw new Error("saved_view_id_required");
  }
  const key = `saved_view:${id.trim()}`;
  const existingRow = db()
    .prepare(`SELECT value FROM meta WHERE key = ?`)
    .get(key) as { value?: string } | undefined;

  let existing: SavedViewPayload & { createdAt?: number | null; updatedAt?: number | null } = {};
  if (existingRow?.value) {
    try {
      const parsed = JSON.parse(existingRow.value) as SavedViewPayload & {
        createdAt?: number;
        updatedAt?: number;
      };
      existing = parsed ?? {};
    } catch (error) {
      existing = {};
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const label =
    payload.label === undefined
      ? (existing.label as string | undefined)
      : payload.label?.trim() && payload.label.trim().length > 0
        ? payload.label.trim()
        : undefined;

  const entry = {
    label: label ?? id.trim(),
    query: payload.query === undefined ? existing.query : payload.query?.trim() || undefined,
    filters: payload.filters === undefined ? existing.filters : payload.filters ?? undefined,
    createdAt: (existing.createdAt as number | null | undefined) ?? now,
    updatedAt: now
  };
  withWriteDatabase((database) => {
    database
      .prepare(`INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(key, JSON.stringify(entry));
  });
}

export function deleteSavedView(id: string) {
  if (!id || !id.trim()) {
    throw new Error("saved_view_id_required");
  }
  const key = `saved_view:${id.trim()}`;
  withWriteDatabase((database) => {
    database.prepare(`DELETE FROM meta WHERE key = ?`).run(key);
  });
}

function getIndexerStatus(): IndexerStatus | null {
  if (!hasTable("indexer_cursor")) return null;
  const dbInstance = getDatabase();
  const cursor = dbInstance
    .prepare(`SELECT last_block as lastBlock, last_ts as lastTs FROM indexer_cursor WHERE chain_id = ?`)
    .get(8453) as { lastBlock: number | null; lastTs: number | null } | undefined;
  if (!cursor || cursor.lastBlock == null || cursor.lastTs == null) return null;

  let seedCompleted = false;
  if (hasTable("indexer_meta")) {
    const metaRow = dbInstance
      .prepare(`SELECT seed_completed as seedCompleted FROM indexer_meta WHERE chain_id = ?`)
      .get(8453) as { seedCompleted: number | null } | undefined;
    seedCompleted = Boolean(metaRow?.seedCompleted);
  }

  const now = Math.floor(Date.now() / 1000);
  const minutesAgo = Math.max(0, (now - Number(cursor.lastTs)) / 60);

  return {
    lastBlock: Number(cursor.lastBlock),
    lastTs: Number(cursor.lastTs),
    minutesAgo: Number(minutesAgo.toFixed(1)),
    seedCompleted
  };
}

export type KPI = {
  key: MetricKey;
  label: string;
  range: RangeKey;
  value: number;
  change?: number;
  format: "currency" | "number";
};

export function getKpis(range: RangeKey = RANGE_DEFAULT): KPI[] {
  const database = getDatabase();
  const since = cutoff(range);

  const capitalRow = database
    .prepare(
      `SELECT SUM(CAST(usdcIn AS INTEGER) - CAST(usdcOut AS INTEGER)) AS net
       FROM trades
       WHERE ts >= ?`
    )
    .get(since) as { net: number | null } | undefined;

  const pnlRow = database
    .prepare(
      `SELECT SUM(CAST(amount AS INTEGER)) AS reward
       FROM rewards
       WHERE kind = 'claim' AND ts >= ?`
    )
    .get(since) as { reward: number | null } | undefined;

  const boostBalances = computeBoostBalances(database).values();
  let openRisk = 0;
  let boostsAvailable = 0;
  for (const entry of boostBalances) {
    const outstanding = entry.sponsored > entry.unlocked ? entry.sponsored - entry.unlocked : 0n;
    openRisk += Number(outstanding) / 1_000_000;
    boostsAvailable += Number(entry.unlocked) / 1_000_000;
  }

  const capital = microsToNumber(capitalRow?.net ?? 0);
  const pnl = microsToNumber(pnlRow?.reward ?? 0);

  return [
    { key: "capital", label: "Capital", range, value: capital, format: "currency" },
    { key: "openRisk", label: "Open Risk", range, value: Number(openRisk.toFixed(2)), format: "currency" },
    { key: "pnl", label: "PnL Today", range, value: pnl, format: "currency" },
    { key: "boosts", label: "Boosts Available", range, value: Number(boostsAvailable.toFixed(2)), format: "currency" }
  ];
}

export type CompetitorMarketInsight = {
  marketId: string;
  title: string;
  createdAt: number;
  boostTotal: number;
  ruleClarity: number | null;
  sourceCount: number;
  settlementRisk: number | null;
};

export type CompetitorEntry = {
  addr: string;
  name: string;
  xHandle: string | null;
  reward14d: number;
  efficiency: number;
  overlapCount: number;
  overlapMarkets: string[];
  lastActiveTs: number | null;
  typicalTradeSize: number | null;
  claimRate: number | null;
  netBoost: number;
  recentMarketCount: number;
  markets: CompetitorMarketInsight[];
};

type IndexerStatus = {
  lastBlock: number;
  lastTs: number;
  minutesAgo: number;
  seedCompleted: boolean;
};

export function getCompetitorWatch(): CompetitorEntry[] {
  const top = getLeaderboard("30d", "total").slice(0, 5);
  const db = getDatabase();
  const recentCutoff = rangeCutoff("30d");
  const myMarkets = ME_ADDRESS ? collectAddressMarkets(db, ME_ADDRESS, recentCutoff) : new Set<string>();

  const tradeStatsStmt = db.prepare(
    `SELECT MAX(ts) AS lastTs,
            AVG(ABS(CAST(usdcIn AS INTEGER) - CAST(usdcOut AS INTEGER))) AS avgNet
     FROM trades
     WHERE lower(trader) = ? AND ts >= ?`
  );

  const rewardStatsStmt = db.prepare(
    `SELECT COUNT(*) AS claims,
            SUM(CASE WHEN CAST(amount_usdc AS INTEGER) > 0 THEN 1 ELSE 0 END) AS positiveClaims,
            MAX(block_time) AS lastClaim
     FROM reward_claims
     WHERE lower(wallet) = ? AND block_time >= ?`
  );

  const boostStatsStmt = db.prepare(
    `SELECT MAX(ts) AS lastTs
     FROM sponsored_locks
     WHERE lower(user) = ? AND ts >= ?`
  );

  const marketStmt = db.prepare(
    `SELECT marketId, metadata, createdAt
     FROM markets
     WHERE lower(creator) = ?
     ORDER BY createdAt DESC
     LIMIT 6`
  );

  const boostMap = computeBoostBalances(db);

  return top.map((entry) => {
    const competitorMarkets = collectAddressMarkets(db, entry.addr, recentCutoff);
    const recentMarketSet = collectAddressMarkets(db, entry.addr, rangeCutoff("7d"));
    const overlapMarkets = ME_ADDRESS ? [...competitorMarkets].filter((id) => myMarkets.has(id)) : [];
    const overlapCount = overlapMarkets.length;

    const tradeStats = tradeStatsStmt.get(entry.addr, recentCutoff) as { lastTs: number | null; avgNet: number | null } | undefined;
    const rewardStats = rewardStatsStmt.get(entry.addr, recentCutoff) as {
      claims: number | null;
      positiveClaims: number | null;
      lastClaim: number | null;
    } | undefined;
    const boostStats = boostStatsStmt.get(entry.addr, recentCutoff) as { lastTs: number | null } | undefined;

    const avgNet = tradeStats?.avgNet ?? null;
    const typicalTradeSize = avgNet != null ? dollars(microsToNumber(avgNet)) : null;
    const claims = rewardStats?.claims ?? 0;
    const positives = rewardStats?.positiveClaims ?? 0;
    const claimRate = claims > 0 ? Number((positives / claims).toFixed(3)) : null;
    const lastTrade = tradeStats?.lastTs ?? 0;
    const lastBoost = boostStats?.lastTs ?? 0;
    const lastClaim = rewardStats?.lastClaim ?? 0;
    const lastActiveRaw = Math.max(lastTrade, lastBoost, lastClaim);
    const lastActiveTs = lastActiveRaw > 0 ? lastActiveRaw : null;

    const marketRows = marketStmt.all(entry.addr) as { marketId: string; metadata: string | null; createdAt: number | null }[];
    const markets: CompetitorMarketInsight[] = marketRows.map((row) => {
      const meta = interpretMetadata(row.metadata);
      const boostEntry = boostMap.get(row.marketId) ?? { sponsored: 0n, unlocked: 0n };
      const outstanding = boostEntry.sponsored > boostEntry.unlocked ? boostEntry.sponsored - boostEntry.unlocked : 0n;
      const boostTotal = Number(outstanding) / 1_000_000;
      const heuristics = meta.heuristics ?? analyzeMarketHeuristics(meta.ruleText ?? meta.raw ?? null, meta.sourceUrls ?? []);
      return {
        marketId: row.marketId,
        title: meta.title ?? row.marketId,
        createdAt: row.createdAt ?? 0,
        boostTotal,
        ruleClarity: heuristics.rule.clarityScore,
        sourceCount: heuristics.sources.urls.length,
        settlementRisk: heuristics.settlement.score
      };
    });

    const netBoost = Number(markets.reduce((acc, market) => acc + market.boostTotal, 0).toFixed(2));

    return {
      addr: entry.addr,
      name: entry.name,
      xHandle: entry.xHandle,
      reward14d: entry.reward,
      efficiency: entry.efficiency,
      overlapCount,
      overlapMarkets: overlapMarkets.slice(0, 6),
      lastActiveTs,
      typicalTradeSize,
      claimRate,
      netBoost,
      recentMarketCount: recentMarketSet.size,
      markets
    } satisfies CompetitorEntry;
  });
}

type BoostEntry = { sponsored: bigint; unlocked: bigint };

function computeBoostBalances(database: BetterSqliteDatabase): Map<string, BoostEntry> {
  const rows = database
    .prepare(
      `SELECT marketId, type, payloadJson
       FROM locks`
    )
    .all() as { marketId: string; type: string | null; payloadJson: string | null }[];

  const map = new Map<string, BoostEntry>();
  for (const row of rows) {
    if (!row.marketId) continue;
    const entry = map.get(row.marketId) ?? { sponsored: 0n, unlocked: 0n };
    const kind = (row.type ?? "").toLowerCase();
    if (kind === "sponsored") {
      entry.sponsored += parseSponsoredAmount(row.payloadJson);
    } else if (kind === "unlock" || kind === "unlocked") {
      entry.unlocked += parseUnlockedAmount(row.payloadJson);
    }
    map.set(row.marketId, entry);
  }
  return map;
}

export type EventLogEntry = {
  ts: number;
  type: string;
  description: string;
  address?: string | null;
  name?: string | null;
  amount?: number | null;
  marketId?: string | null;
  marketTitle?: string | null;
};

export function getEventLog(range: RangeKey = RANGE_DEFAULT, limit = 50): EventLogEntry[] {
  const db = getDatabase();
  const since = cutoff(range);

  const rewardRows = db
    .prepare(
      `SELECT block_time AS ts, wallet, amount_usdc AS amount
       FROM reward_claims
       WHERE block_time >= ?
       ORDER BY block_time DESC
       LIMIT ?`
    )
    .all(since, limit) as { ts: number; wallet: string | null; amount: string | null }[];

  const lockRows = db
    .prepare(
      `SELECT ts, user, type, marketId
       FROM locks
       WHERE ts >= ?
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(since, limit) as { ts: number; user: string | null; type: string | null; marketId: string | null }[];

  const tradeRows = db
    .prepare(
      `SELECT ts, marketId, trader, usdcIn, usdcOut
       FROM trades
       WHERE ts >= ?
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(since, limit) as {
      ts: number;
      marketId: string;
      trader: string | null;
      usdcIn: string | null;
      usdcOut: string | null;
    }[];

  const addressCache = new Map<string, string>();
  const profileStmt = db.prepare(
    `SELECT display_name AS displayName, x_handle AS xHandle
     FROM profiles
     WHERE lower(address) = ?`
  );

  const formatAmountLabel = (value: number) => {
    if (value >= 1_000) return `$${value.toFixed(0)}`;
    if (value >= 100) return `$${value.toFixed(1)}`;
    return `$${value.toFixed(2)}`;
  };

  const identityFor = (addr: string | null | undefined): string | null => {
    if (!addr) return null;
    const normalized = addr.toLowerCase();
    if (addressCache.has(normalized)) {
      return addressCache.get(normalized) ?? null;
    }
    const profile = profileStmt.get(normalized) as {
      displayName: string | null;
      xHandle: string | null;
    } | undefined;
    const name = resolveIdentity({
      address: normalized,
      displayName: profile?.displayName ?? null,
      xHandle: profile?.xHandle ?? null
    });
    addressCache.set(normalized, name);
    return name;
  };

  const marketTitleCacheLocal = new Map<string, string>();
  const marketTitleFor = (marketId: string | null | undefined): string | null => {
    if (!marketId) return null;
    if (!marketTitleCacheLocal.has(marketId)) {
      marketTitleCacheLocal.set(marketId, lookupMarketTitle(db, marketId));
    }
    return marketTitleCacheLocal.get(marketId) ?? null;
  };

  const rewards = rewardRows.map<EventLogEntry>((row) => {
    const address = row.wallet ? row.wallet.toLowerCase() : null;
    const amount = dollars(microsToNumber(row.amount ?? 0));
    return {
      ts: row.ts,
      type: "reward",
      description: `claimed ${formatAmountLabel(amount)}`,
      address,
      name: identityFor(address),
      amount
    } satisfies EventLogEntry;
  });

  const locks = lockRows
    .map<EventLogEntry | null>((row) => {
      const kind = row.type?.toLowerCase() ?? "";
      if (kind !== "sponsored") return null;
      const address = row.user ? row.user.toLowerCase() : null;
      const marketId = row.marketId ?? null;
      return {
        ts: row.ts,
        type: "boost",
        description: "boosted liquidity",
        address,
        name: identityFor(address),
        marketId,
        marketTitle: marketTitleFor(marketId)
      } satisfies EventLogEntry;
    })
    .filter(Boolean) as EventLogEntry[];

  const trades = tradeRows
    .map<EventLogEntry | null>((row) => {
      const inAmount = microsToNumber(row.usdcIn ?? 0);
      const outAmount = microsToNumber(row.usdcOut ?? 0);
      const gross = inAmount + outAmount;
      if (gross < 250) return null;
      const net = outAmount - inAmount;
      const direction = net >= 0 ? "sold" : "bought";
      const amount = dollars(gross);
      const address = row.trader ? row.trader.toLowerCase() : null;
      const marketId = row.marketId ?? null;
      return {
        ts: row.ts,
        type: "trade",
        description: `${direction} ${formatAmountLabel(amount)}`,
        address,
        name: identityFor(address),
        amount,
        marketId,
        marketTitle: marketTitleFor(marketId)
      } satisfies EventLogEntry;
    })
    .filter(Boolean) as EventLogEntry[];

  return [...rewards, ...locks, ...trades].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function getErrorLog(): string[] {
  return [];
}

export function getMeAddress(): string | null {
  return ME_ADDRESS;
}

export function getWalletIdentity(address: string): { address: string; name: string; xHandle: string | null } | null {
  if (!address) return null;
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;
  const dbInstance = getDatabase();
  const row = dbInstance
    .prepare(
      `SELECT display_name AS displayName, x_handle AS xHandle
       FROM profiles
       WHERE lower(address) = ?`
    )
    .get(normalized) as {
      displayName: string | null;
      xHandle: string | null;
    } | undefined;

  const name = resolveIdentity({
    address: normalized,
    displayName: row?.displayName ?? null,
    xHandle: row?.xHandle ?? null
  });

  return {
    address: normalized,
    name,
    xHandle: row?.xHandle ?? null
  };
}

export type PnlRow = {
  addr: string;
  name: string;
  xHandle: string | null;
  reward: number;
  netFlow: number;
  pnl: number;
};

export function getPnl(range: LeaderboardRange, limit = 50): PnlRow[] {
  const db = getDatabase();
  const cutoff = rangeCutoff(range);

  const rewardRows = db
    .prepare(
      `SELECT lower(user) AS addr,
              SUM(CAST(amount AS INTEGER)) AS reward
       FROM rewards
       WHERE user IS NOT NULL AND kind = 'claim' AND ts >= ?
       GROUP BY addr`
    )
    .all(cutoff) as { addr: string; reward: number | null }[];

  const tradeRows = db
    .prepare(
      `SELECT lower(trader) AS addr,
              SUM(CAST(usdcOut AS INTEGER) - CAST(usdcIn AS INTEGER)) AS net
       FROM trades
       WHERE trader IS NOT NULL AND ts >= ?
       GROUP BY addr`
    )
    .all(cutoff) as { addr: string; net: number | null }[];

  const profileStmt = db.prepare(
    `SELECT display_name AS displayName, x_handle AS xHandle
     FROM profiles
     WHERE lower(address) = ?`
  );

  const rewardMap = new Map<string, number>();
  for (const row of rewardRows) {
    rewardMap.set(row.addr, microsToNumber(row.reward ?? 0));
  }

  const tradeMap = new Map<string, number>();
  for (const row of tradeRows) {
    tradeMap.set(row.addr, microsToNumber(row.net ?? 0));
  }

  const addresses = new Set<string>([...rewardMap.keys(), ...tradeMap.keys()]);

  const rows: PnlRow[] = [];
  for (const addr of addresses) {
    const profile = profileStmt.get(addr) as { displayName: string | null; xHandle: string | null } | undefined;
    const reward = rewardMap.get(addr) ?? 0;
    const netFlow = tradeMap.get(addr) ?? 0;
    const pnl = reward + netFlow;
    rows.push({
      addr,
      name: profile?.displayName ?? shortenAddress(addr),
      xHandle: profile?.xHandle ?? null,
      reward,
      netFlow,
      pnl
    });
  }

  return rows
    .sort((a, b) => b.pnl - a.pnl || b.reward - a.reward)
    .slice(0, limit);
}

type MetadataInfo = {
  title?: string;
  cutoffTs?: number;
  raw?: string;
  ruleText?: string | null;
  sourceUrls?: string[];
  heuristics?: MarketHeuristics;
  category?: string | null;
};

function interpretMetadata(metadata?: string | null): MetadataInfo {
  if (!metadata) return {};

  let decoded = metadata;
  if (metadata.startsWith("0x")) {
    try {
      const raw = Buffer.from(metadata.slice(2), "hex");
      const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
      const buffer = isGzip ? gunzipSync(raw) : raw;
      decoded = buffer.toString("utf8");
    } catch (error) {
      decoded = metadata;
    }
  }

  const trimmed = decoded?.trim() ?? "";
  const info: MetadataInfo = {};
  const sourceCandidates = new Set<string>();
  if (trimmed) {
    info.raw = trimmed;
  }

  if (!trimmed) {
    return info;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const title = resolveTitleFromMeta(parsed);
      if (title) info.title = title;
      const cutoff = resolveCutoffFromMeta(parsed);
      if (cutoff) info.cutoffTs = cutoff;
      const category = resolveCategoryFromMeta(parsed);
      if (category) info.category = category;
      const rule = resolveRuleFromMeta(parsed);
      if (rule) info.ruleText = rule;
      const parsedSources = resolveSourcesFromMeta(parsed);
      for (const url of parsedSources) {
        sourceCandidates.add(url);
      }
      if (!info.title && typeof parsed === "string" && parsed.trim().length > 0) {
        info.title = parsed.trim();
      }
    } catch (error) {
      // fall back to text parsing
    }
  }

  if (!info.cutoffTs) {
    const ts = extractTimestampFromText(trimmed);
    if (ts) info.cutoffTs = ts;
  }

  if (!info.ruleText && trimmed) {
    info.ruleText = trimmed;
  }

  if (info.raw) {
    for (const url of extractUrlsFromText(info.raw)) {
      sourceCandidates.add(url);
    }
  }

  if (sourceCandidates.size > 0) {
    info.sourceUrls = [...sourceCandidates];
  } else {
    info.sourceUrls = [];
  }

  const heuristicRule = info.ruleText ?? info.title ?? info.raw ?? null;
  info.heuristics = analyzeMarketHeuristics(heuristicRule, info.sourceUrls);

  if (!info.title && trimmed) {
    info.title = trimmed;
  }

  return info;
}

function deriveTitle(metadata?: string | null): string | null {
  const info = interpretMetadata(metadata);
  return info.title ?? info.raw ?? null;
}

const TITLE_KEYS = [
  "shorttext",
  "title",
  "text",
  "question",
  "name",
  "prompt",
  "headline",
  "summary",
  "description"
];
const CATEGORY_KEYS = [
  "category",
  "categories",
  "topic",
  "tag",
  "tags",
  "sector",
  "league",
  "sport"
];
const TIME_KEYS = [
  "close",
  "closetime",
  "close_time",
  "deadline",
  "resolve",
  "resolvetime",
  "resolutiontime",
  "resolution_time",
  "resolutionts",
  "resolveat",
  "resolve_at",
  "end",
  "endtime",
  "expiry",
  "expiration",
  "expire",
  "settle",
  "settlement",
  "cutoff",
  "cutoffts"
];

const RULE_KEYS = [
  "rule",
  "rules",
  "description",
  "details",
  "criteria",
  "resolution",
  "settlement",
  "grading",
  "adjudication"
];

const SOURCE_KEYS = [
  "sources",
  "links",
  "references",
  "citations",
  "urls",
  "feeds"
];

const URL_CAPTURE_REGEX = /https?:\/\/[^\s)"']+/gi;

function resolveTitleFromMeta(value: unknown): string | undefined {
  return extractTitleFromMeta(value, new Set());
}

function extractTitleFromMeta(value: unknown, seen: Set<unknown>): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractTitleFromMeta(entry, seen);
      if (match) return match;
    }
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (TITLE_KEYS.includes(lower)) {
      const candidate = obj[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
    }
  }

  for (const key of Object.keys(obj)) {
    const nested = extractTitleFromMeta(obj[key], seen);
    if (nested) return nested;
  }

  return undefined;
}

function resolveRuleFromMeta(value: unknown): string | undefined {
  return extractRuleFromMeta(value, new Set());
}

function resolveCategoryFromMeta(value: unknown): string | undefined {
  return extractCategoryFromMeta(value, new Set());
}

function extractCategoryFromMeta(value: unknown, seen: Set<unknown>): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed.length <= 48) {
      return trimmed;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractCategoryFromMeta(entry, seen);
      if (match) return match;
    }
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (CATEGORY_KEYS.includes(lower)) {
      const candidate = extractCategoryFromMeta(obj[key], seen);
      if (candidate) return candidate;
    }
  }

  for (const key of Object.keys(obj)) {
    const nested = extractCategoryFromMeta(obj[key], seen);
    if (nested) return nested;
  }

  return undefined;
}

function extractRuleFromMeta(value: unknown, seen: Set<unknown>): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = extractRuleFromMeta(entry, seen);
      if (match) return match;
    }
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  for (const key of RULE_KEYS) {
    if (key in obj) {
      const match = extractRuleFromMeta(obj[key], seen);
      if (match) return match;
    }
  }

  for (const key of Object.keys(obj)) {
    const match = extractRuleFromMeta(obj[key], seen);
    if (match) return match;
  }

  return undefined;
}

function resolveSourcesFromMeta(value: unknown): string[] {
  const out = new Set<string>();
  collectSourcesFromMeta(value, new Set(), out);
  return [...out];
}

function collectSourcesFromMeta(value: unknown, seen: Set<unknown>, out: Set<string>) {
  if (!value) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isLikelyUrl(trimmed)) {
      out.add(trimmed);
    }
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectSourcesFromMeta(entry, seen, out);
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of SOURCE_KEYS) {
    if (key in obj) {
      collectSourcesFromMeta(obj[key], seen, out);
    }
  }
  for (const key of Object.keys(obj)) {
    collectSourcesFromMeta(obj[key], seen, out);
  }
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(URL_CAPTURE_REGEX) ?? [];
  return matches.filter(isLikelyUrl);
}

function isLikelyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function resolveCutoffFromMeta(value: unknown): number | undefined {
  return extractCutoffFromMeta(value, new Set());
}

function extractCutoffFromMeta(value: unknown, seen: Set<unknown>): number | undefined {
  if (typeof value === "number") {
    return normalizeTimestamp(value);
  }
  if (typeof value === "string") {
    return parseTimeString(value);
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const ts = extractCutoffFromMeta(entry, seen);
      if (ts) return ts;
    }
    return undefined;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj.seconds === "number") {
    const ts = normalizeTimestamp(obj.seconds);
    if (ts) return ts;
  }
  if (typeof obj.timestamp === "number") {
    const ts = normalizeTimestamp(obj.timestamp);
    if (ts) return ts;
  }
  if (typeof obj.timestamp === "string") {
    const ts = parseTimeString(obj.timestamp);
    if (ts) return ts;
  }

  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (TIME_KEYS.includes(lower)) {
      const ts = extractCutoffFromMeta(obj[key], seen);
      if (ts) return ts;
    }
  }

  for (const key of Object.keys(obj)) {
    const ts = extractCutoffFromMeta(obj[key], seen);
    if (ts) return ts;
  }

  return undefined;
}

function parseTimeString(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    return normalizeTimestamp(Number(trimmed));
  }
  const isoLike = trimmed.includes(" ") && !trimmed.includes("T") ? trimmed.replace(" ", "T") : trimmed;
  const parsed = Date.parse(isoLike);
  if (!Number.isNaN(parsed)) {
    return Math.floor(parsed / 1000);
  }
  return undefined;
}

function normalizeTimestamp(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (value > 10_000_000_000) {
    return Math.floor(value / 1000);
  }
  if (value >= 946684800) { // >= Jan 1 2000
    return Math.floor(value);
  }
  return undefined;
}

function extractTimestampFromText(text: string): number | undefined {
  const isoMatch = text.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?/);
  if (isoMatch) {
    const candidate = isoMatch[0].includes(" ") && !isoMatch[0].includes("T") ? isoMatch[0].replace(" ", "T") : isoMatch[0];
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  const dateMatch = text.match(/\d{4}-\d{2}-\d{2}/);
  if (dateMatch) {
    const parsed = Date.parse(`${dateMatch[0]}T00:00:00Z`);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  const numericMatches = text.match(/\b\d{10,13}\b/g);
  if (numericMatches) {
    for (const candidate of numericMatches) {
      const ts = normalizeTimestamp(Number(candidate));
      if (ts) return ts;
    }
  }

  return undefined;
}

export type WalletExposureRow = {
  addr: string;
  outstandingBoost: number;
  boostPaid: number;
  subsidy: number;
  actualCost: number;
  tradeVolume: number;
  netCash: number;
  marketsBoosted: number;
  marketsTraded: number;
  lastActivity: number | null;
};

export type BoostLedgerRow = {
  marketId: string;
  ts: number;
  setsAmount: number;
  userPaid: number;
  subsidyUsed: number;
  actualCost: number;
  outcomes: number | null;
};

export function getWalletExposure(limit = 50): WalletExposureRow[] {
  const dbInstance = getDatabase();

  const lockAgg = dbInstance
    .prepare(
      `SELECT lower(locker) AS addr,
              SUM(CASE WHEN lower(type) = 'lock'
                       THEN CAST(json_extract(payloadJson, '$.total') AS INTEGER)
                       ELSE 0 END) AS locked,
              SUM(CASE WHEN lower(type) = 'unlock'
                       THEN CAST(json_extract(payloadJson, '$.total') AS INTEGER)
                       ELSE 0 END) AS unlocked,
              MAX(ts) AS lastLockTs
         FROM locks
        WHERE locker IS NOT NULL
        GROUP BY lower(locker)`
    )
    .all() as { addr: string; locked: number | null; unlocked: number | null; lastLockTs: number | null }[];

  const sponsoredAgg = dbInstance
    .prepare(
      `SELECT lower(user) AS addr,
              SUM(CAST(COALESCE(userPaid, '0') AS INTEGER)) AS paid,
              SUM(CAST(COALESCE(subsidyUsed, '0') AS INTEGER)) AS subsidy,
              SUM(CAST(COALESCE(actualCost, '0') AS INTEGER)) AS cost,
              COUNT(DISTINCT marketId) AS markets,
              MAX(ts) AS lastSponsoredTs
         FROM sponsored_locks
        WHERE user IS NOT NULL
        GROUP BY lower(user)`
    )
    .all() as {
      addr: string;
      paid: number | null;
      subsidy: number | null;
      cost: number | null;
      markets: number | null;
      lastSponsoredTs: number | null;
    }[];

  const tradeAgg = dbInstance
    .prepare(
      `SELECT lower(trader) AS addr,
              SUM(CAST(usdcIn AS INTEGER) - CAST(usdcOut AS INTEGER)) AS netCash,
              SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS volume,
              COUNT(DISTINCT marketId) AS markets,
              MAX(ts) AS lastTradeTs
         FROM trades
        WHERE trader IS NOT NULL
        GROUP BY lower(trader)`
    )
    .all() as {
      addr: string;
      netCash: number | null;
      volume: number | null;
      markets: number | null;
      lastTradeTs: number | null;
    }[];

  const map = new Map<string, {
    addr: string;
    locked: number;
    unlocked: number;
    lastActivity: number;
    boostPaid: number;
    subsidy: number;
    cost: number;
    marketsBoosted: number;
    netCash: number;
    tradeVolume: number;
    marketsTraded: number;
  }>();

  for (const row of lockAgg) {
    const locked = Number(row.locked ?? 0);
    const unlocked = Number(row.unlocked ?? 0);
    const last = row.lastLockTs != null ? Number(row.lastLockTs) : 0;
    const entry = map.get(row.addr) ?? {
      addr: row.addr,
      locked: 0,
      unlocked: 0,
      lastActivity: 0,
      boostPaid: 0,
      subsidy: 0,
      cost: 0,
      marketsBoosted: 0,
      netCash: 0,
      tradeVolume: 0,
      marketsTraded: 0
    };
    entry.locked += locked;
    entry.unlocked += unlocked;
    entry.lastActivity = Math.max(entry.lastActivity, last);
    map.set(row.addr, entry);
  }

  for (const row of sponsoredAgg) {
    const entry = map.get(row.addr) ?? {
      addr: row.addr,
      locked: 0,
      unlocked: 0,
      lastActivity: 0,
      boostPaid: 0,
      subsidy: 0,
      cost: 0,
      marketsBoosted: 0,
      netCash: 0,
      tradeVolume: 0,
      marketsTraded: 0
    };
    entry.boostPaid += Number(row.paid ?? 0);
    entry.subsidy += Number(row.subsidy ?? 0);
    entry.cost += Number(row.cost ?? 0);
    entry.marketsBoosted = Math.max(entry.marketsBoosted, Number(row.markets ?? 0));
    entry.lastActivity = Math.max(entry.lastActivity, Number(row.lastSponsoredTs ?? 0));
    map.set(row.addr, entry);
  }

  for (const row of tradeAgg) {
    const entry = map.get(row.addr) ?? {
      addr: row.addr,
      locked: 0,
      unlocked: 0,
      lastActivity: 0,
      boostPaid: 0,
      subsidy: 0,
      cost: 0,
      marketsBoosted: 0,
      netCash: 0,
      tradeVolume: 0,
      marketsTraded: 0
    };
    entry.netCash += Number(row.netCash ?? 0);
    entry.tradeVolume += Number(row.volume ?? 0);
    entry.marketsTraded = Math.max(entry.marketsTraded, Number(row.markets ?? 0));
    entry.lastActivity = Math.max(entry.lastActivity, Number(row.lastTradeTs ?? 0));
    map.set(row.addr, entry);
  }

  const microsToFloat = (value: number) => Number((value / 1_000_000).toFixed(2));

  return [...map.values()]
    .map((entry) => {
      const outstandingMicros = Math.max(0, entry.locked - entry.unlocked);
      const outstandingBoost = microsToFloat(outstandingMicros);
      const boostPaid = microsToFloat(entry.boostPaid);
      const subsidy = microsToFloat(entry.subsidy);
      const actualCost = microsToFloat(entry.cost);
      const tradeVolume = microsToFloat(entry.tradeVolume);
      const netCash = microsToFloat(entry.netCash);
      const lastActivity = entry.lastActivity > 0 ? entry.lastActivity : null;
      return {
        addr: entry.addr,
        outstandingBoost,
        boostPaid,
        subsidy,
        actualCost,
        tradeVolume,
        netCash,
        marketsBoosted: entry.marketsBoosted,
        marketsTraded: entry.marketsTraded,
        lastActivity
      } satisfies WalletExposureRow;
    })
    .filter((row) => row.outstandingBoost > 0 || row.boostPaid > 0 || row.tradeVolume > 0)
    .sort((a, b) => b.outstandingBoost - a.outstandingBoost || b.tradeVolume - a.tradeVolume)
    .slice(0, limit);
}

export function getBoostLedger(address: string, limit = 40): BoostLedgerRow[] {
  const dbInstance = getDatabase();
  const normalized = address.toLowerCase();
  const rows = dbInstance
    .prepare(
      `SELECT marketId,
              ts,
              setsAmount,
              userPaid,
              subsidyUsed,
              actualCost,
              outcomes
         FROM sponsored_locks
        WHERE lower(user) = ?
        ORDER BY ts DESC
        LIMIT ?`
    )
    .all(normalized, limit) as {
      marketId: string;
      ts: number;
      setsAmount: string | null;
      userPaid: string | null;
      subsidyUsed: string | null;
      actualCost: string | null;
      outcomes: number | null;
    }[];

  const toNumber = (value: string | null) => {
    if (!value) return 0;
    try {
      return Number(BigInt(value)) / 1_000_000;
    } catch (error) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed / 1_000_000 : 0;
    }
  };

  return rows.map((row) => ({
    marketId: row.marketId,
    ts: row.ts,
    setsAmount: Number(toNumber(row.setsAmount).toFixed(2)),
    userPaid: Number(toNumber(row.userPaid).toFixed(2)),
    subsidyUsed: Number(toNumber(row.subsidyUsed).toFixed(2)),
    actualCost: Number(toNumber(row.actualCost).toFixed(2)),
    outcomes: row.outcomes
  }));
}
