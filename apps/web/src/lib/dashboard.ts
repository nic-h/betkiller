import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as Range from "@/lib/timeRange";

export type RangeKey = "24h" | "7d" | "30d";

const MICRO = 1_000_000;

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name=?")
    .get(name) as { c: number };
  return !!row?.c;
}

function openDB(): Database.Database {
  const envPath = process.env.DB_PATH;
  if (envPath && fs.existsSync(envPath)) {
    return new Database(envPath, { readonly: true });
  }

  if (process.env.NODE_ENV === "test") {
    const fixture = path.resolve(process.cwd(), "tests/fixtures/context.test.sqlite");
    if (fs.existsSync(fixture)) {
      return new Database(fixture, { readonly: true });
    }
  }

  const defaultPath = path.resolve(process.cwd(), "./db/context.sqlite");
  return new Database(defaultPath, { readonly: true, fileMustExist: false });
}

function windowSince(range: RangeKey): number {
  const fallback: Record<RangeKey, number> = {
    "24h": 24 * 60 * 60,
    "7d": 7 * 24 * 60 * 60,
    "30d": 30 * 24 * 60 * 60
  };
  const seconds = typeof Range.toSeconds === "function" ? Range.toSeconds(range) : fallback[range];
  return Math.floor(Date.now() / 1000) - seconds;
}

function fromMicros(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Number((numeric / MICRO).toFixed(2));
}

function toBigInt(value: number | string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "number") return BigInt(Math.round(value));
  try {
    return BigInt(value);
  } catch (error) {
    return 0n;
  }
}

function fetchProfiles(db: Database.Database, addresses: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (addresses.length === 0) return map;
  if (hasTable(db, "identity_map")) {
    const stmt = db.prepare(
      `SELECT lower(addr) AS addr, name
         FROM identity_map
        WHERE lower(addr) IN (${addresses.map(() => "?").join(",")})`
    );
    for (const row of stmt.all(...addresses.map((addr) => addr.toLowerCase()))) {
      if (row?.addr) {
        map.set(row.addr, row.name ?? "");
      }
    }
    return map;
  }

  if (hasTable(db, "profiles")) {
    const stmt = db.prepare(
      `SELECT lower(address) AS addr, COALESCE(display_name, x_handle) AS label
         FROM profiles
        WHERE lower(address) IN (${addresses.map(() => "?").join(",")})`
    );
    for (const row of stmt.all(...addresses.map((addr) => addr.toLowerCase()))) {
      if (row?.addr) {
        map.set(row.addr, row.label ?? "");
      }
    }
  }
  return map;
}

export type LeaderboardRow = {
  addr: string;
  name: string;
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

export function getLeaderboard(range: RangeKey): LeaderboardRow[] {
  const db = openDB();
  try {
    const rows: LeaderboardRow[] = [];
    const since = windowSince(range);

    if (!hasTable(db, "trades")) {
      if (!hasTable(db, "events_norm")) {
        return [];
      }

      const fallback = db
        .prepare(
          `SELECT user AS addr,
                  COALESCE(SUM(CASE kind
                    WHEN 'CLAIM'        THEN amount_fp
                    WHEN 'REFUND'       THEN amount_fp
                    WHEN 'REWARD'       THEN amount_fp
                    WHEN 'SELL'         THEN amount_fp
                    WHEN 'BUY'          THEN -amount_fp
                    WHEN 'BOOST_ADD'    THEN -amount_fp
                    WHEN 'BOOST_REMOVE' THEN  amount_fp
                  END), 0) AS epv_fp
             FROM events_norm
            WHERE ts >= ?
            GROUP BY user
            ORDER BY epv_fp DESC
            LIMIT 100`
        )
        .all(since) as Array<{ addr: string; epv_fp: number | string | null }>;

      return fallback.map((row) => ({
        addr: row.addr,
        name: "",
        capitalAtRisk: fromMicros(row.epv_fp),
        pnl: 0,
        rewards: 0,
        netProfit: 0,
        roiPercent: 0,
        weight: 0,
        weightedScore: 0,
        trades: 0,
        volume: 0,
        roiRank: 0
      }));
    }

    const tradeRows = db
      .prepare(
        `SELECT lower(trader) AS addr,
                SUM(CAST(usdcIn AS INTEGER)) AS totalIn,
                SUM(CAST(usdcOut AS INTEGER)) AS totalOut,
                SUM(CAST(usdcIn AS INTEGER) + CAST(usdcOut AS INTEGER)) AS totalVolume,
                COUNT(*) AS trades
           FROM trades
          WHERE trader IS NOT NULL
            AND ts >= ?
          GROUP BY addr`
      )
      .all(since) as Array<{
      addr: string;
      totalIn: number | string | null;
      totalOut: number | string | null;
      totalVolume: number | string | null;
      trades: number | null;
    }>;

    const rewardRows = hasTable(db, "rewards")
      ? (db
          .prepare(
            `SELECT lower(user) AS addr,
                    SUM(CAST(amount AS INTEGER)) AS rewards
               FROM rewards
              WHERE user IS NOT NULL
                AND ts >= ?
              GROUP BY addr`
          )
          .all(since) as Array<{ addr: string; rewards: number | string | null }>)
      : [];

    const rewardMap = new Map<string, number>();
    for (const row of rewardRows) {
      rewardMap.set(row.addr, fromMicros(row.rewards));
    }

    const addresses = new Set<string>();
    for (const row of tradeRows) {
      if (row.addr) addresses.add(row.addr);
    }
    for (const row of rewardRows) {
      if (row.addr) addresses.add(row.addr);
    }

    const profiles = fetchProfiles(db, Array.from(addresses));

    for (const row of tradeRows) {
      const addr = row.addr;
      const totalIn = fromMicros(row.totalIn);
      const totalOut = fromMicros(row.totalOut);
      const volume = fromMicros(row.totalVolume);
      const trades = row.trades ?? 0;

      const capitalAtRisk = Math.max(totalIn - totalOut, 0);
      const pnl = Number((totalOut - totalIn).toFixed(2));
      const rewards = rewardMap.get(addr) ?? 0;
      const netProfit = Number((pnl + rewards).toFixed(2));
      const roiPercent = capitalAtRisk > 0 ? Number(((netProfit / capitalAtRisk) * 100).toFixed(2)) : 0;
      const weight = capitalAtRisk > 0 ? Number(Math.log10(capitalAtRisk + 1).toFixed(3)) : 0;
      const weightedScore = Number((roiPercent * weight).toFixed(3));

      rows.push({
        addr,
        name: profiles.get(addr) ?? "",
        capitalAtRisk,
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

    // include addresses that only have rewards
    for (const [addr, reward] of rewardMap.entries()) {
      if (rows.some((row) => row.addr === addr)) continue;
      rows.push({
        addr,
        name: profiles.get(addr) ?? "",
        capitalAtRisk: 0,
        pnl: 0,
        rewards: reward,
        netProfit: reward,
        roiPercent: 0,
        weight: 0,
        weightedScore: 0,
        trades: 0,
        volume: 0,
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
      row.roiRank = row.weightedScore > 0 ? rank++ : 0;
    }

    return rows;
  } finally {
    db.close();
  }
}

export type MarketSummaryRow = {
  marketId: string;
  boostLocked: number;
  biggestYes: { addr: string; netExposure: number } | null;
  biggestNo: { addr: string; netExposure: number } | null;
  top_yes_rank: number;
  top_no_rank: number;
};

export function getMarketSummaries(
  range: RangeKey,
  limit = 10,
  leaderboardIndex?: Map<string, number>
): MarketSummaryRow[] {
  const db = openDB();
  try {
    const since = windowSince(range);
    const markets = hasTable(db, "trades")
      ? (db
          .prepare(
            `SELECT DISTINCT marketId
               FROM trades
              WHERE ts >= ?
              LIMIT ?`
          )
          .all(since, limit) as Array<{ marketId: string }>)
      : hasTable(db, "events_norm")
      ? (db
          .prepare(
            `SELECT DISTINCT market
               FROM events_norm
              WHERE market IS NOT NULL
                AND ts >= ?
              LIMIT ?`
          )
          .all(since, limit) as Array<{ market: string }>).map((row) => ({ marketId: row.market }))
      : [];

    const lockRows = db
      .prepare(
        `SELECT marketId, type, payloadJson
           FROM locks`
      )
      .all() as Array<{ marketId: string | null; type: string | null; payloadJson: string | null }>;

    const exposures = db
      .prepare(
        `SELECT lower(trader) AS addr,
                marketId,
                SUM(CAST(usdcIn AS INTEGER)) AS totalIn,
                SUM(CAST(usdcOut AS INTEGER)) AS totalOut
           FROM trades
          WHERE trader IS NOT NULL
            AND ts >= ?
          GROUP BY marketId, addr`
      )
      .all(since) as Array<{
      addr: string;
      marketId: string;
      totalIn: number | string | null;
      totalOut: number | string | null;
    }>;

    const boostMap = new Map<string, { sponsored: bigint; unlocked: bigint }>();
    for (const row of lockRows) {
      if (!row.marketId) continue;
      const market = row.marketId;
      const entry = boostMap.get(market) ?? { sponsored: 0n, unlocked: 0n };
      const kind = (row.type ?? "").toLowerCase();
      try {
        const payload = row.payloadJson ? JSON.parse(row.payloadJson) : {};
        if (kind.includes("sponsored")) {
          entry.sponsored += toBigInt(payload.actualCost ?? payload.sponsored ?? 0);
        } else if (kind.includes("unlock")) {
          const amounts = Array.isArray(payload.amounts)
            ? payload.amounts.map((value: unknown) => toBigInt(value))
            : [toBigInt(payload.amount ?? 0)];
          entry.unlocked += amounts.reduce((sum, current) => sum + current, 0n);
        }
      } catch (error) {
        // ignore malformed payloads
      }
      boostMap.set(market, entry);
    }

    const results: MarketSummaryRow[] = [];

    for (const { marketId } of markets) {
      const marketExposures = exposures.filter((row) => row.marketId === marketId);
      let bestYes: { addr: string; exposure: number } | null = null;
      let bestNo: { addr: string; exposure: number } | null = null;

      for (const row of marketExposures) {
        const net = fromMicros(row.totalIn) - fromMicros(row.totalOut);
        if (net > 0) {
          if (!bestYes || net > bestYes.exposure) {
            bestYes = { addr: row.addr, exposure: net };
          }
        } else if (net < 0) {
          const abs = Math.abs(net);
          if (!bestNo || abs > bestNo.exposure) {
            bestNo = { addr: row.addr, exposure: abs };
          }
        }
      }

      const boostEntry = boostMap.get(marketId) ?? { sponsored: 0n, unlocked: 0n };
      const boostLocked = Number(((boostEntry.sponsored - boostEntry.unlocked) / BigInt(MICRO)).toFixed(2));

      results.push({
        marketId,
        boostLocked,
        biggestYes: bestYes ? { addr: bestYes.addr, netExposure: Number(bestYes.exposure.toFixed(2)) } : null,
        biggestNo: bestNo ? { addr: bestNo.addr, netExposure: Number(bestNo.exposure.toFixed(2)) } : null,
        top_yes_rank: bestYes ? leaderboardIndex?.get(bestYes.addr.toLowerCase()) ?? Infinity : Infinity,
        top_no_rank: bestNo ? leaderboardIndex?.get(bestNo.addr.toLowerCase()) ?? Infinity : Infinity
      });
    }

    return results;
  } finally {
    db.close();
  }
}
