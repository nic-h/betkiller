import Database, { type Database as BetterSqliteDatabase } from "better-sqlite3";
import { Buffer } from "buffer";
import fs from "fs";
import path from "path";
import { gunzipSync } from "node:zlib";

const DB_PATH =
  process.env.SQLITE_PATH ?? process.env.BK_DB ?? process.env.DATABASE_PATH ?? "../../data/context-edge.db";
const ME_ADDRESS = process.env.BK_ME?.toLowerCase() ?? null;


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

export function hasTable(name: string): boolean {
  const row = db()
    .prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ? LIMIT 1")
    .get(name);
  return !!row;
}

export function cutoff(range?: string): number {
  const nowSec = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  const normalized = (range ?? "14d").toLowerCase();
  switch (normalized) {
    case "24h":
      return nowSec - day;
    case "7d":
      return nowSec - 7 * day;
    case "30d":
      return nowSec - 30 * day;
    case "ytd": {
      const now = new Date();
      const start = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000;
      return Math.floor(start);
    }
    case "all":
      return 0;
    case "14d":
    default:
      return nowSec - 14 * day;
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

export type LeaderboardBucket = "total" | "creator" | "booster" | "trader" | "eff";
export type LeaderboardRange = "24h" | "7d" | "14d" | "30d" | "ytd" | "all";

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
    `SELECT display_name AS displayName, x_handle AS xHandle
     FROM profiles
     WHERE lower(address) = ?`
  );

  const stakeMap = new Map<string, { stake: number; markets: number }>();
  for (const row of stakeRows) {
    stakeMap.set(row.addr, {
      stake: row.stake ?? 0,
      markets: row.markets ?? 0
    });
  }

  const results: LeaderboardRow[] = rewardRows
    .map((row) => {
      const profile = profileStmt.get(row.addr) as { displayName: string | null; xHandle: string | null } | undefined;
      const stakeInfo = stakeMap.get(row.addr) ?? { stake: 0, markets: 0 };
      const rewardMicro = row.reward ?? 0;
      const rewardDollars = rewardMicro / 1_000_000;
      const stakeDollars = (stakeInfo.stake ?? 0) / 1_000_000;
      const efficiency = stakeDollars > 0 ? rewardDollars / stakeDollars : rewardDollars > 0 ? rewardDollars : 0;
      return {
        addr: row.addr,
        name: profile?.displayName ?? shortenAddress(row.addr),
        xHandle: profile?.xHandle ?? null,
        reward: rewardDollars,
        rewardCreator: rewardDollars,
        rewardBooster: 0,
        rewardTrader: 0,
        efficiency,
        marketsTouched: stakeInfo.markets ?? 0,
        recentRewardTs: row.last_ts ?? null
      };
    })
    .sort((a, b) => {
      const key = bucket === "eff" ? b.efficiency - a.efficiency : (bucket === "creator" ? b.rewardCreator - a.rewardCreator : b.reward - a.reward);
      if (key !== 0) return key;
      if ((b.marketsTouched ?? 0) !== (a.marketsTouched ?? 0)) return (b.marketsTouched ?? 0) - (a.marketsTouched ?? 0);
      return (b.recentRewardTs ?? 0) - (a.recentRewardTs ?? 0);
    })
    .slice(0, 100);

  return results;
}

export type SlateItem = {
  marketId: string;
  title: string;
  cutoffTs: number;
  boostTotal: number;
  volume24h: number;
  uniqueTraders24h: number;
  edgeScore: number;
  tvl: number;
  depth: number;
};

export function getLiveSlate(): SlateItem[] {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const cutoff24h = now - 24 * 3600;

  const markets = db
    .prepare(
      `SELECT marketId, metadata, createdAt
       FROM markets`
    )
    .all() as { marketId: string; metadata: string | null; createdAt: number | null }[];

  const tradeRows = db
    .prepare(
      `SELECT marketId, SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS volume,
              COUNT(DISTINCT trader) AS traders
       FROM trades
       WHERE ts >= ?
       GROUP BY marketId`
    )
    .all(cutoff24h) as { marketId: string; volume: number | null; traders: number | null }[];

  const lockRows = db
    .prepare(
      `SELECT marketId, type, payloadJson
       FROM locks`
    )
    .all() as { marketId: string; type: string | null; payloadJson: string | null }[];

  const stateRows = db
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

  const boostMap = new Map<string, { sponsored: bigint; unlocked: bigint }>();
  for (const row of lockRows) {
    const marketId = row.marketId;
    if (!marketId) continue;
    const entry = boostMap.get(marketId) ?? { sponsored: 0n, unlocked: 0n };
    const kind = (row.type ?? "").toLowerCase();
    if (kind === "sponsored") {
      const amount = parseSponsoredAmount(row.payloadJson);
      entry.sponsored += amount;
    } else if (kind === "unlock" || kind === "unlocked") {
      const amount = parseUnlockedAmount(row.payloadJson);
      entry.unlocked += amount;
    }
    boostMap.set(marketId, entry);
  }

  const tvlMap = new Map<string, { totalUsdc: number; totalQ: number }>();
  for (const row of stateRows) {
    tvlMap.set(row.marketId, {
      totalUsdc: microsToNumber(row.totalUsdc),
      totalQ: microsToNumber(row.totalQ)
    });
  }

  return markets
    .map((market) => {
      const meta = interpretMetadata(market.metadata);
      const title = meta.title ?? market.marketId;
      const volumeInfo = volumeMap.get(market.marketId) ?? { volume: 0, traders: 0 };
      const boostEntry = boostMap.get(market.marketId) ?? { sponsored: 0n, unlocked: 0n };
      const outstanding = boostEntry.sponsored > boostEntry.unlocked ? boostEntry.sponsored - boostEntry.unlocked : 0n;
      const boostTotal = Number(outstanding) / 1_000_000;
      const volume24h = (volumeInfo.volume ?? 0) / 1_000_000;
      const uniqueTraders24h = volumeInfo.traders ?? 0;
      const fallbackCutoff = (market.createdAt ?? now) + 72 * 3600;
      const cutoffCandidate = meta.cutoffTs ?? null;
      const cutoffTs = cutoffCandidate && cutoffCandidate > 0 ? cutoffCandidate : fallbackCutoff;
      const edgeScore = (boostTotal * 0.4 + volume24h * 0.4 + uniqueTraders24h * 0.2) * ((cutoffTs - now >= 3600 && cutoffTs - now <= 7 * 86400) ? 1 : 0.6);
      const state = tvlMap.get(market.marketId) ?? { totalUsdc: 0, totalQ: 0 };
      return {
        marketId: market.marketId,
        title,
        cutoffTs,
        boostTotal,
        volume24h,
        uniqueTraders24h,
        edgeScore,
        tvl: state.totalUsdc,
        depth: state.totalQ
      };
    })
    .sort((a, b) => b.edgeScore - a.edgeScore)
    .slice(0, 20);
}

export type NearResolutionItem = {
  marketId: string;
  title: string;
  cutoffTs: number;
};

export function getNearResolution(): NearResolutionItem[] {
  const now = Math.floor(Date.now() / 1000);
  return getLiveSlate()
    .filter((item) => item.cutoffTs >= now && item.cutoffTs <= now + 3 * 86400)
    .sort((a, b) => a.cutoffTs - b.cutoffTs)
    .slice(0, 50)
    .map(({ marketId, title, cutoffTs }) => ({ marketId, title, cutoffTs }));
}

export type RewardSplit = {
  bucket: string;
  reward: number;
  stake: number;
};

export function getMySummary(range: LeaderboardRange): RewardSplit[] {
  if (!ME_ADDRESS) return [];
  const db = getDatabase();
  const cutoff = rangeCutoff(range);

  const rewardRow = db
    .prepare(
      `SELECT SUM(CAST(amount AS INTEGER)) AS reward
       FROM rewards
       WHERE user = ? AND kind = 'claim' AND ts >= ?`
    )
    .get(ME_ADDRESS, cutoff) as { reward: number | null } | undefined;

  const stakeRow = db
    .prepare(
      `SELECT SUM(CAST(usdcIn AS INTEGER)) AS stake
       FROM trades
       WHERE trader = ? AND ts >= ?`
    )
    .get(ME_ADDRESS, cutoff) as { stake: number | null } | undefined;

  const totalReward = microsToNumber(rewardRow?.reward ?? 0);
  const totalStake = microsToNumber(stakeRow?.stake ?? 0);

  const bucketRows = db
    .prepare(
      `SELECT kind, SUM(CAST(amount AS INTEGER)) AS reward
       FROM rewards
       WHERE user = ? AND kind IN ('creator', 'booster', 'trader') AND ts >= ?
       GROUP BY kind`
    )
    .all(ME_ADDRESS, cutoff) as { kind: string; reward: number | null }[];

  const splits: RewardSplit[] = [{ bucket: 'TOTAL', reward: totalReward, stake: totalStake }];

  for (const row of bucketRows) {
    const key = row.kind.toUpperCase();
    const reward = microsToNumber(row.reward ?? 0);
    splits.push({ bucket: key, reward, stake: 0 });
  }

  return splits;
}

export type KPI = {
  label: string;
  value: number;
  change?: number;
};

export function getKpis(): KPI[] {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const cutoffDay = now - 86400;

  const volumeRow = db
    .prepare(
      `SELECT SUM(CAST(usdcIn AS INTEGER) - CAST(usdcOut AS INTEGER)) AS net
       FROM trades`
    )
    .get() as { net: number | null } | undefined;

  const pnlRow = db
    .prepare(
      `SELECT SUM(CAST(amount AS INTEGER)) AS reward
       FROM rewards
       WHERE kind = 'claim' AND ts >= ?`
    )
    .get(cutoffDay) as { reward: number | null } | undefined;

  const boostRow = db
    .prepare(
      `SELECT payloadJson
       FROM locks
       WHERE ts >= ?`
    )
    .all(cutoffDay) as { payloadJson: string }[];

  const bankroll = microsToNumber(volumeRow?.net ?? 0);
  const pnlToday = microsToNumber(pnlRow?.reward ?? 0);
  const rewardsToday = pnlToday;
  const openRisk = boostRow.reduce((acc, row) => acc + Number(sumPayloadAmounts(row.payloadJson)) / 1_000_000, 0);

  const out: KPI[] = [
    { label: "Global Bankroll", value: bankroll },
    { label: "Global PnL (24h)", value: pnlToday },
    { label: "Global Rewards (24h)", value: rewardsToday },
    { label: "Open Risk", value: openRisk }
  ];

  if (ME_ADDRESS) {
    const mySummary = getMySummary("24h");
    const total = mySummary.find((entry) => entry.bucket === "TOTAL");
    if (total) {
      out.push({ label: "My Rewards (24h)", value: total.reward });
    }
  }

  return out;
}

export type CompetitorEntry = {
  addr: string;
  name: string;
  xHandle: string | null;
  markets: { marketId: string; title: string; createdAt: number; boostTotal: number }[];
};

export function getCompetitorWatch(): CompetitorEntry[] {
  const top = getLeaderboard("14d", "total").slice(0, 3);
  const db = getDatabase();
  const marketStmt = db.prepare(
    `SELECT marketId, metadata, createdAt
     FROM markets
     WHERE lower(creator) = ?
     ORDER BY createdAt DESC
     LIMIT 5`
  );
  const boostStmt = db.prepare(
    `SELECT payloadJson
     FROM locks
     WHERE marketId = ?`
  );

  return top.map((entry) => {
    const rows = marketStmt.all(entry.addr) as { marketId: string; metadata: string | null; createdAt: number | null }[];
    const markets = rows.map((row) => {
      const boosts = boostStmt.all(row.marketId) as { payloadJson: string }[];
      const boostTotal = boosts.reduce((acc, b) => acc + Number(sumPayloadAmounts(b.payloadJson)) / 1_000_000, 0);
      return {
        marketId: row.marketId,
        title: deriveTitle(row.metadata) ?? row.marketId,
        createdAt: row.createdAt ?? 0,
        boostTotal
      };
    });
    return {
      addr: entry.addr,
      name: entry.name,
      xHandle: entry.xHandle,
      markets
    };
  });
}

export type EventLogEntry = {
  ts: number;
  type: string;
  description: string;
};

export function getEventLog(limit = 50): EventLogEntry[] {
  const db = getDatabase();
  const rewardRows = db
    .prepare(
      `SELECT ts, user, amount
       FROM rewards
       WHERE kind = 'claim'
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(limit) as { ts: number; user: string | null; amount: string | null }[];

  const lockRows = db
    .prepare(
      `SELECT ts, user, type
       FROM locks
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(limit) as { ts: number; user: string; type: string }[];

  const rewards = rewardRows.map<EventLogEntry>((row) => ({
    ts: row.ts,
    type: "reward",
    description: `${shortenAddress(row.user ?? "-")} claimed $${microsToNumber(row.amount ?? 0).toFixed(2)}`
  }));

  const locks = lockRows.map<EventLogEntry>((row) => ({
    ts: row.ts,
    type: "lock",
    description: `${shortenAddress(row.user)} ${row.type.toLowerCase()}`
  }));

  return [...rewards, ...locks].sort((a, b) => b.ts - a.ts).slice(0, limit);
}

export function getErrorLog(): string[] {
  return [];
}

export function getMeAddress(): string | null {
  return ME_ADDRESS;
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

  if (!info.title && trimmed) {
    info.title = trimmed;
  }

  return info;
}

function deriveTitle(metadata?: string | null): string | null {
  const info = interpretMetadata(metadata);
  return info.title ?? info.raw ?? null;
}

const TITLE_KEYS = ["title", "question", "name", "prompt", "headline", "summary"];
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

function shortenAddress(address: string | null | undefined): string {
  if (!address) return "-";
  const lower = address.toLowerCase();
  return `${lower.slice(0, 6)}…${lower.slice(-4)}`;
}
