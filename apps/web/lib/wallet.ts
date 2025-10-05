import { getDatabase, toMicroNumber } from "@/lib/database";
import { buildLeaderboardIndex, type LeaderboardIndex } from "@/lib/leaderboard";
import { fromMicros } from "@/lib/num";
import { normalizeRange, type RangeKey } from "@/lib/range";

const ME_ADDRESS = process.env.BK_ME?.toLowerCase() ?? null;

export type WalletSnapshot = {
  address: string;
  capitalAtRisk: number;
  boostAvailable: number;
  boostLocked: number;
  pnl: number;
  rewards: number;
  netDeployed: number;
  roiPercent: number;
  roiRank: number;
};

export function getConfiguredWalletAddress(): string | null {
  return ME_ADDRESS;
}

export function getWalletSnapshot(range: RangeKey, index?: LeaderboardIndex, overrideAddress?: string | null): WalletSnapshot | null {
  const normalized = normalizeRange(range);
  const address = (overrideAddress ?? ME_ADDRESS)?.toLowerCase();
  if (!address) return null;

  const db = getDatabase();
  const leaderboard = index ?? buildLeaderboardIndex(normalized);
  const since = rangeCutoffSeconds(normalized);

  const positionRows = db
    .prepare(
      `SELECT marketId,
              SUM(CAST(usdcIn AS INTEGER)) AS totalIn,
              SUM(CAST(usdcOut AS INTEGER)) AS totalOut
       FROM trades
       WHERE lower(trader) = ?
       GROUP BY marketId`
    )
    .all(address) as { marketId: string; totalIn: string | number | null; totalOut: string | number | null }[];

  let outstandingMicros = 0n;
  for (const row of positionRows) {
    const totalIn = toMicroNumber(row.totalIn);
    const totalOut = toMicroNumber(row.totalOut);
    if (totalIn > totalOut) {
      outstandingMicros += totalIn - totalOut;
    }
  }

  const boostRows = db
    .prepare(
      `SELECT type, payloadJson
       FROM locks
       WHERE lower(user) = ?`
    )
    .all(address) as { type: string | null; payloadJson: string | null }[];

  let sponsoredMicros = 0n;
  let unlockedMicros = 0n;
  for (const row of boostRows) {
    const kind = (row.type ?? "").toLowerCase();
    if (kind === "sponsored") {
      sponsoredMicros += parseSponsoredAmount(row.payloadJson);
    } else if (kind === "unlock" || kind === "unlocked") {
      unlockedMicros += parseUnlockedAmount(row.payloadJson);
    }
  }

  const pnlRow = db
    .prepare(
      `SELECT SUM(CAST(usdcOut AS INTEGER) - CAST(usdcIn AS INTEGER)) AS pnl,
              SUM(CAST(usdcIn AS INTEGER)) AS buys,
              SUM(CAST(usdcOut AS INTEGER)) AS sells
       FROM trades
       WHERE lower(trader) = ? AND ts >= ?`
    )
    .get(address, since) as { pnl: string | number | null; buys: string | number | null; sells: string | number | null } | undefined;

  const rewardsRow = db
    .prepare(
      `SELECT SUM(CAST(amount AS INTEGER)) AS rewards
       FROM rewards
       WHERE lower(user) = ? AND ts >= ?`
    )
    .get(address, since) as { rewards: string | number | null } | undefined;

  const capitalAtRisk = Number(fromMicros(outstandingMicros).toFixed(2));
  const boostAvailable = Number(fromMicros(unlockedMicros).toFixed(2));
  const boostLockedMicros = sponsoredMicros > unlockedMicros ? sponsoredMicros - unlockedMicros : 0n;
  const boostLocked = Number(fromMicros(boostLockedMicros).toFixed(2));

  const pnl = Number(fromMicros(pnlRow?.pnl ?? 0).toFixed(2));
  const buys = fromMicros(pnlRow?.buys ?? 0);
  const sells = fromMicros(pnlRow?.sells ?? 0);
  const netDeployed = Number((buys - sells).toFixed(2));
  const rewards = Number(fromMicros(rewardsRow?.rewards ?? 0).toFixed(2));

  const leaderboardEntry = leaderboard.get(address);
  const roiPercent = leaderboardEntry ? leaderboardEntry.roiPercent : capitalAtRisk > 0 ? Number(((pnl + rewards) / capitalAtRisk * 100).toFixed(2)) : 0;
  const roiRank = leaderboardEntry ? leaderboardEntry.roiRank : 0;

  return {
    address,
    capitalAtRisk,
    boostAvailable,
    boostLocked,
    pnl,
    rewards,
    netDeployed,
    roiPercent,
    roiRank
  } satisfies WalletSnapshot;
}

function parseSponsoredAmount(payloadJson: string | null): bigint {
  if (!payloadJson) return 0n;
  try {
    const parsed = JSON.parse(payloadJson);
    let total = 0n;
    if (parsed?.actualCost != null) total += toMicroNumber(parsed.actualCost);
    if (parsed?.userPaid != null) total += toMicroNumber(parsed.userPaid);
    if (parsed?.subsidyUsed != null) total += toMicroNumber(parsed.subsidyUsed);
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
      return parsed.amounts.reduce<bigint>((total, entry) => total + toMicroNumber(entry), 0n);
    }
    return 0n;
  } catch (error) {
    return 0n;
  }
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
