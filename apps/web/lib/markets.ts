import { Buffer } from "buffer";
import { gunzipSync } from "node:zlib";

import { getDatabase, toMicroNumber } from "@/lib/database";
import { fromMicros } from "@/lib/num";
import { normalizeRange, type RangeKey } from "@/lib/range";

export type MarketSummary = {
  marketId: string;
  title: string;
  cutoffTs: number;
  boostLocked: number;
  tvl: number;
  volume24h: number;
  traderCount: number;
  edgeScore: number;
  lastPriceYes: number | null;
  priceSeries: number[];
  tvlSeries: number[];
};

export function getMarketSummaries(range: RangeKey, limit = 32): MarketSummary[] {
  const normalized = normalizeRange(range);
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const since24h = now - 24 * 60 * 60;

  const marketRows = db
    .prepare(
      `SELECT marketId, metadata, createdAt
         FROM markets`
    )
    .all() as { marketId: string; metadata: string | null; createdAt: number | null }[];

  const boostRows = db
    .prepare(
      `SELECT marketId, type, payloadJson
         FROM locks`
    )
    .all() as { marketId: string | null; type: string | null; payloadJson: string | null }[];

  const tvlRows = db
    .prepare(
      `SELECT marketId, totalUsdc
         FROM market_state
        WHERE id IN (SELECT MAX(id) FROM market_state GROUP BY marketId)`
    )
    .all() as { marketId: string; totalUsdc: string | number | null }[];

  const volumeRows = db
    .prepare(
      `SELECT marketId,
              SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS volume,
              COUNT(DISTINCT lower(trader)) AS traders
         FROM trades
        WHERE trader IS NOT NULL AND ts >= ?
        GROUP BY marketId`
    )
    .all(since24h) as { marketId: string; volume: string | number | null; traders: number | null }[];

  const boostMap = new Map<string, { sponsored: bigint; unlocked: bigint }>();
  for (const row of boostRows) {
    if (!row.marketId) continue;
    const marketId = row.marketId;
    const entry = boostMap.get(marketId) ?? { sponsored: 0n, unlocked: 0n };
    const kind = (row.type ?? "").toLowerCase();
    if (kind === "sponsored") {
      entry.sponsored += parseSponsoredAmount(row.payloadJson);
    } else if (kind === "unlock" || kind === "unlocked") {
      entry.unlocked += parseUnlockedAmount(row.payloadJson);
    }
    boostMap.set(marketId, entry);
  }

  const tvlMap = new Map<string, number>();
  for (const row of tvlRows) {
    tvlMap.set(row.marketId, Number(fromMicros(row.totalUsdc ?? 0).toFixed(2)));
  }

  const volumeMap = new Map<string, number>();
  const traderMap = new Map<string, number>();
  for (const row of volumeRows) {
    volumeMap.set(row.marketId, Number(fromMicros(row.volume ?? 0).toFixed(2)));
    traderMap.set(row.marketId, row.traders ?? 0);
  }

  const summaries = marketRows.map((market) => {
    const meta = interpretMetadata(market.metadata);
    const boostEntry = boostMap.get(market.marketId) ?? { sponsored: 0n, unlocked: 0n };
    const outstandingBoost = boostEntry.sponsored > boostEntry.unlocked ? boostEntry.sponsored - boostEntry.unlocked : 0n;
    const boostLocked = Number(fromMicros(outstandingBoost).toFixed(2));
    const tvl = tvlMap.get(market.marketId) ?? 0;
    const volume24h = volumeMap.get(market.marketId) ?? 0;
    const traderCount = traderMap.get(market.marketId) ?? 0;
    const cutoffTs = meta.cutoffTs ?? (market.createdAt ?? now) + 72 * 60 * 60;
    const edgeScore = Number((boostLocked * 0.6 + tvl * 0.3 + volume24h * 0.1).toFixed(2));

    return {
      marketId: market.marketId,
      title: meta.title ?? market.marketId,
      cutoffTs,
      boostLocked,
      tvl,
      volume24h,
      traderCount,
      edgeScore,
      lastPriceYes: null,
      priceSeries: [],
      tvlSeries: []
    } satisfies MarketSummary;
  });

  summaries.sort((a, b) => {
    if (b.boostLocked !== a.boostLocked) return b.boostLocked - a.boostLocked;
    if (b.tvl !== a.tvl) return b.tvl - a.tvl;
    if (b.volume24h !== a.volume24h) return b.volume24h - a.volume24h;
    return a.marketId.localeCompare(b.marketId);
  });

  const selected = summaries.slice(0, limit);
  if (selected.length === 0) {
    return [];
  }

  const priceStmt = db.prepare(
    `SELECT ts, pricesJson
         FROM prices
        WHERE marketId = ?
        ORDER BY ts DESC
        LIMIT 48`
  );

  const tvlStmt = db.prepare(
    `SELECT ts, totalUsdc
         FROM market_state
        WHERE marketId = ?
        ORDER BY ts DESC
        LIMIT 48`
  );

  for (const summary of selected) {
    const priceRows = priceStmt.all(summary.marketId) as { ts: number; pricesJson: string | null }[];
    const priceSeries = priceRows
      .map((row) => parsePriceVector(row.pricesJson))
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .slice(0, 24)
      .reverse();
    summary.priceSeries = priceSeries;
    summary.lastPriceYes = priceSeries.length > 0 ? priceSeries[priceSeries.length - 1] : null;

    const tvlRowsForMarket = tvlStmt.all(summary.marketId) as { ts: number; totalUsdc: string | number | null }[];
    summary.tvlSeries = tvlRowsForMarket
      .map((row) => Number(fromMicros(row.totalUsdc ?? 0).toFixed(2)))
      .slice(0, 24)
      .reverse();
  }

  return selected;
}

function parsePriceVector(json: string | null): number | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const first = parsed[0];
      const value = typeof first === "number" ? first : Number(first);
      return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
    }
  } catch (error) {
    return null;
  }
  return null;
}

type MetadataInfo = {
  title: string | null;
  cutoffTs: number | null;
};

function interpretMetadata(metadata?: string | null): MetadataInfo {
  if (!metadata) return { title: null, cutoffTs: null };

  let decoded = metadata;
  if (metadata.startsWith("0x") && metadata.length > 2) {
    try {
      const hex = metadata.slice(2);
      const raw = Buffer.from(hex, "hex");
      const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
      const buffer = isGzip ? gunzipSync(raw) : raw;
      decoded = buffer.toString("utf8");
    } catch (error) {
      decoded = metadata;
    }
  }

  const trimmed = decoded.trim();
  if (!trimmed) {
    return { title: null, cutoffTs: null };
  }

  const info: MetadataInfo = { title: null, cutoffTs: null };
  const parsed = tryParseJson(trimmed);
  if (parsed !== undefined) {
    info.title = findFirstString(parsed, TITLE_KEYS) ?? null;
    const cutoffCandidate = findFirstNumber(parsed, TIME_KEYS);
    if (cutoffCandidate && cutoffCandidate > 1_000_000_000) {
      info.cutoffTs = cutoffCandidate;
    }
  }

  if (!info.title) {
    info.title = trimmed;
  }

  return info;
}

function tryParseJson(value: string): unknown | undefined {
  if (!value || (value[0] !== "{" && value[0] !== "[")) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return undefined;
  }
}

const TITLE_KEYS = ["title", "question", "name", "text", "prompt", "summary", "headline"];
const TIME_KEYS = ["close", "deadline", "resolve", "end", "expiry", "expiration", "resolveAt", "resolve_at"];

function findFirstString(value: unknown, keys: string[]): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findFirstString(entry, keys);
      if (match) return match;
    }
    return undefined;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if (keys.includes(lower)) {
        const match = findFirstString(obj[key], keys);
        if (match) return match;
      }
    }
  }
  return undefined;
}

function findFirstNumber(value: unknown, keys: string[]): number | undefined {
  if (!value) return undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const match = findFirstNumber(entry, keys);
      if (match) return match;
    }
    return undefined;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const lower = key.toLowerCase();
      if (keys.includes(lower)) {
        const raw = obj[key];
        if (typeof raw === "string") {
          const numeric = Number(raw);
          if (Number.isFinite(numeric)) {
            return numeric;
          }
        } else {
          const match = findFirstNumber(raw, keys);
          if (match) return match;
        }
      }
    }
  }
  return undefined;
}

function parseSponsoredAmount(payloadJson: string | null): bigint {
  if (!payloadJson) return 0n;
  try {
    const parsed = JSON.parse(payloadJson);
    if (parsed?.actualCost != null) {
      return toMicroNumber(parsed.actualCost);
    }
    let total = 0n;
    if (parsed?.userPaid != null) {
      total += toMicroNumber(parsed.userPaid);
    }
    if (parsed?.subsidyUsed != null) {
      total += toMicroNumber(parsed.subsidyUsed);
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
    if (Array.isArray(parsed?.amounts)) {
      return parsed.amounts.reduce<bigint>((total, value) => total + toMicroNumber(value), 0n);
    }
    return 0n;
  } catch (error) {
    return 0n;
  }
}
