import { getDatabase } from "@/lib/database";
import { resolveName } from "@/lib/identity";
import { fromMicros } from "@/lib/num";
import { normalizeRange, type RangeKey } from "@/lib/range";

export type LeaderboardRow = {
  addr: string;
  name: string;
  profile: { displayName: string | null; xHandle: string | null } | null;
  capitalAtRisk: number;
  pnl: number;
  rewards: number;
  netProfit: number;
  roiPercent: number;
  weight: number;
  weightedScore: number;
  trades: number;
  volume: number;
  roiRank: number;
};

export type LeaderboardIndex = Map<string, LeaderboardRow>;

export function getLeaderboard(range: RangeKey): LeaderboardRow[] {
  const normalized = normalizeRange(range);
  const db = getDatabase();
  const since = rangeCutoffSeconds(normalized);

  const tradeRows = db
    .prepare(
      `SELECT lower(trader) AS addr,
              SUM(CAST(usdcOut AS INTEGER) - CAST(usdcIn AS INTEGER)) AS pnl,
              SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS volume,
              COUNT(*) AS trades
       FROM trades
       WHERE trader IS NOT NULL AND ts >= ?
       GROUP BY addr`
    )
    .all(since) as {
    addr: string;
    pnl: string | number | null;
    volume: string | number | null;
    trades: number | null;
  }[];

  const rewardRows = db
    .prepare(
      `SELECT lower(user) AS addr,
              SUM(CAST(amount AS INTEGER)) AS rewards
       FROM rewards
       WHERE user IS NOT NULL AND ts >= ?
       GROUP BY addr`
    )
    .all(since) as { addr: string; rewards: string | number | null }[];

  const capitalRows = db
    .prepare(
      `SELECT lower(trader) AS addr,
              SUM(CAST(usdcIn AS INTEGER)) AS totalIn,
              SUM(CAST(usdcOut AS INTEGER)) AS totalOut
       FROM trades
       WHERE trader IS NOT NULL
       GROUP BY addr`
    )
    .all() as {
    addr: string;
    totalIn: string | number | null;
    totalOut: string | number | null;
  }[];

  const addresses = new Set<string>();
  for (const row of tradeRows) {
    if (row.addr) addresses.add(row.addr);
  }
  for (const row of rewardRows) {
    if (row.addr) addresses.add(row.addr);
  }
  for (const row of capitalRows) {
    if (row.addr) addresses.add(row.addr);
  }

  const pnlMap = new Map<string, number>();
  const volumeMap = new Map<string, number>();
  const tradeMap = new Map<string, number>();
  for (const row of tradeRows) {
    pnlMap.set(row.addr, Number(fromMicros(row.pnl ?? 0).toFixed(2)));
    volumeMap.set(row.addr, Number(fromMicros(row.volume ?? 0).toFixed(2)));
    tradeMap.set(row.addr, row.trades ?? 0);
  }

  const rewardMap = new Map<string, number>();
  for (const row of rewardRows) {
    rewardMap.set(row.addr, Number(fromMicros(row.rewards ?? 0).toFixed(2)));
  }

  const capitalMap = new Map<string, number>();
  for (const row of capitalRows) {
    const totalIn = toNumberMicros(row.totalIn);
    const totalOut = toNumberMicros(row.totalOut);
    const outstanding = Math.max(totalIn - totalOut, 0);
    capitalMap.set(row.addr, Number(fromMicros(outstanding).toFixed(2)));
  }

  if (addresses.size === 0) return [];

  const profiles = loadProfiles(Array.from(addresses));

  const rows: LeaderboardRow[] = [];
  for (const addr of addresses) {
    const capital = capitalMap.get(addr) ?? 0;
    const pnl = pnlMap.get(addr) ?? 0;
    const rewards = rewardMap.get(addr) ?? 0;
    const netProfit = Number((pnl + rewards).toFixed(2));
    const roiPercent = capital > 0 ? Number(((netProfit / capital) * 100).toFixed(2)) : 0;
    const weight = capital > 0 ? Number(Math.log10(capital + 1).toFixed(3)) : 0;
    const weightedScore = Number((roiPercent * weight).toFixed(3));

    const profile = profiles.get(addr) ?? null;
    const name = resolveName(profile, addr);
    const volume = volumeMap.get(addr) ?? 0;
    const trades = tradeMap.get(addr) ?? 0;

    rows.push({
      addr,
      name,
      profile,
      capitalAtRisk: capital,
      pnl,
      rewards,
      netProfit,
      roiPercent,
      weight,
      weightedScore,
      trades,
      volume,
      roiRank: 0
    });
  }

  rows.sort((a, b) => {
    const scoreDiff = b.weightedScore - a.weightedScore;
    if (scoreDiff !== 0) return scoreDiff;
    const roiDiff = b.roiPercent - a.roiPercent;
    if (roiDiff !== 0) return roiDiff;
    const capitalDiff = b.capitalAtRisk - a.capitalAtRisk;
    if (capitalDiff !== 0) return capitalDiff;
    return a.addr.localeCompare(b.addr);
  });

  let rank = 1;
  for (const row of rows) {
    row.roiRank = row.weightedScore > 0 ? rank : 0;
    rank += 1;
  }

  return rows;
}

export function buildLeaderboardIndex(range: RangeKey): LeaderboardIndex {
  const rows = getLeaderboard(range);
  const map: LeaderboardIndex = new Map();
  for (const row of rows) {
    map.set(row.addr, row);
  }
  return map;
}

function rangeCutoffSeconds(range: RangeKey): number {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  switch (range) {
    case "24h":
      return now - day;
    case "1w":
      return now - 7 * day;
    case "1m":
    default:
      return now - 30 * day;
  }
}

function toNumberMicros(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function loadProfiles(addresses: string[]): Map<string, { displayName: string | null; xHandle: string | null }> {
  if (addresses.length === 0) return new Map();
  const db = getDatabase();
  const map = new Map<string, { displayName: string | null; xHandle: string | null }>();
  const batchSize = 999; // SQLite limit
  for (let offset = 0; offset < addresses.length; offset += batchSize) {
    const batch = addresses.slice(offset, offset + batchSize);
    const placeholders = batch.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT lower(address) AS addr, display_name AS displayName, x_handle AS xHandle
         FROM profiles
         WHERE lower(address) IN (${placeholders})`
      )
      .all(...batch) as { addr: string; displayName: string | null; xHandle: string | null }[];
    for (const row of rows) {
      map.set(row.addr, { displayName: row.displayName ?? null, xHandle: row.xHandle ?? null });
    }
  }
  return map;
}
