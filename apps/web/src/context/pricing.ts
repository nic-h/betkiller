import { getDb } from "@/lib/db";
import { getPublicClient } from "@/context/client";
import PredictionMarketAbi from "@/abi/PredictionMarket.json";
import OutcomeTokenAbi from "@/abi/OutcomeTokenImpl.json";
import { CONTRACT_ADDRESSES } from "@/context/addresses";
import { type Address, type Hex, zeroAddress } from "viem";

const ONE = 1_000_000n; // 1e6 fixed point used by PredictionMarket

type MarketState = {
  resolved: boolean;
  outcomeTokens: Address[];
  payoutPcts: bigint[];
  prices: bigint[];
};

type MarketCacheEntry = {
  state: MarketState;
  fetchedAt: number;
};

const CACHE_TTL_MS = 30_000;

const marketCache = new Map<string, MarketCacheEntry>();

export function invalidateMarketCache(marketId: string) {
  marketCache.delete(marketId.toLowerCase());
}

export async function getSpotPrice(marketId: string): Promise<MarketState> {
  const key = marketId.toLowerCase();
  const cached = marketCache.get(key);
  if (cached) {
    if (cached.state.resolved || Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.state;
    }
  }

  const client = getPublicClient();
  let info: any;
  try {
    info = await client.readContract({
      address: CONTRACT_ADDRESSES.predictionMarket as Address,
      abi: PredictionMarketAbi as any,
      functionName: "getMarketInfo",
      args: [marketId as Hex]
    });
  } catch (error) {
    console.warn(`getMarketInfo failed for ${marketId}`, error);
    return {
      resolved: false,
      outcomeTokens: [],
      payoutPcts: [],
      prices: []
    };
  }

  const resolved = Boolean(info.resolved);
  const outcomeTokens = (info.outcomeTokens ?? []) as Address[];
  const payoutPcts = (info.payoutPcts ?? []).map((value: any) => BigInt(value));
  let prices: bigint[] = [];

  if (!resolved) {
    const outcomeQs = (info.outcomeQs ?? []).map((value: any) => BigInt(value));
    const alpha = BigInt(info.alpha ?? 0);
    try {
      const result = await client.readContract({
        address: CONTRACT_ADDRESSES.predictionMarket as Address,
        abi: PredictionMarketAbi as any,
        functionName: "calcPrice",
        args: [outcomeQs, alpha]
      });
      prices = (result ?? []).map((value: any) => BigInt(value));
    } catch (error) {
      console.warn(`calcPrice failed for ${marketId}`, error);
      prices = [];
    }
  }

  const state: MarketState = {
    resolved,
    outcomeTokens,
    payoutPcts,
    prices
  };

  marketCache.set(key, { state, fetchedAt: Date.now() });

  const db = getDb();
  db.prepare(
    `UPDATE markets
        SET updated_ts = ?,
            resolved = CASE WHEN ? THEN 1 ELSE resolved END
      WHERE market = ?`
  ).run(Math.floor(Date.now() / 1000), state.resolved ? 1 : 0, key);
  if (prices.length > 0) {
    const primaryPrice = prices[0] ?? 0n;
    db.prepare(
      `INSERT INTO market_price(market, p_yes_fp, updated_ts)
       VALUES(?, ?, ?)
       ON CONFLICT(market) DO UPDATE SET p_yes_fp=excluded.p_yes_fp, updated_ts=excluded.updated_ts`
    ).run(key, primaryPrice.toString(), Math.floor(Date.now() / 1000));
  }

  if (resolved) {
    const winningIndex = payoutPcts.findIndex((value) => value > 0n);
    const winningSide = winningIndex === 0 ? "YES" : winningIndex === 1 ? "NO" : winningIndex >= 0 ? `IDX${winningIndex}` : null;
    db.prepare(
      `INSERT INTO resolved_markets(market, resolved_ts, winning_side)
       VALUES(?, ?, ?)
       ON CONFLICT(market) DO UPDATE SET resolved_ts=excluded.resolved_ts, winning_side=excluded.winning_side`
    ).run(key, Math.floor(Date.now() / 1000), winningSide);
  }

  return state;
}

export async function getMTMForUser(user: Address): Promise<bigint> {
  if (!user || user === zeroAddress) return 0n;
  const db = getDb();
  const positions = db
    .prepare(
      `SELECT market, side, qty_fp
       FROM shares_open
       WHERE user = ?`
    )
    .all(user.toLowerCase());

  let totalValue = 0n;

  for (const position of positions) {
    if (!position.market || !position.side) continue;
    const qty = BigInt(position.qty_fp ?? 0);
    if (qty === 0n) continue;

    const marketState = await getSpotPrice(position.market);
    if (marketState.resolved || marketState.prices.length === 0) continue;

    const index = position.side === "YES" ? 0 : position.side === "NO" ? 1 : -1;
    if (index < 0 || index >= marketState.prices.length) continue;
    const price = marketState.prices[index];
    totalValue += (qty * price) / ONE;
  }

  return totalValue;
}

export async function getUnclaimedClaimsForUser(user: Address): Promise<bigint> {
  if (!user || user === zeroAddress) return 0n;
  const lower = user.toLowerCase();
  const db = getDb();
  const markets = db
    .prepare(`SELECT DISTINCT market FROM events_norm WHERE user = ? AND market IS NOT NULL`)
    .all(lower)
    .map((row: { market: string }) => row.market.toLowerCase());

  if (markets.length === 0) {
    db.prepare(`DELETE FROM claimables WHERE user = ?`).run(lower);
    return 0n;
  }

  const client = getPublicClient();
  const perMarket = new Map<string, bigint>();

  for (const marketId of markets) {
    const state = await getSpotPrice(marketId);
    if (!state.resolved) continue;

    const { outcomeTokens, payoutPcts } = state;
    if (!outcomeTokens || outcomeTokens.length === 0) continue;

    let claimable = 0n;
    for (let i = 0; i < outcomeTokens.length; i += 1) {
      const pct = payoutPcts[i] ?? 0n;
      if (pct === 0n) continue;
      const token = outcomeTokens[i];
      const balance = await client.readContract({
        address: token,
        abi: OutcomeTokenAbi as any,
        functionName: "balanceOf",
        args: [user]
      });
      const shares = BigInt(balance ?? 0n);
      if (shares === 0n) continue;
      claimable += (shares * pct) / ONE;
    }

    if (claimable > 0n) {
      perMarket.set(marketId, claimable);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(
    `INSERT INTO claimables(user, market, amount_fp, updated_ts)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(user, market) DO UPDATE SET amount_fp=excluded.amount_fp, updated_ts=excluded.updated_ts`
  );

  db.prepare(`DELETE FROM claimables WHERE user = ?`).run(lower);
  for (const [market, amount] of perMarket.entries()) {
    insert.run(lower, market, amount.toString(), now);
  }

  const total = Array.from(perMarket.values()).reduce((sum, value) => sum + value, 0n);
  return total;
}
