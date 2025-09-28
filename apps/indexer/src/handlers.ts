import { JsonRpcProvider, Interface, Log, getAddress } from "ethers";
import { predictionMarketAbi, vaultAbi, rewardDistributorAbi } from "./abi.js";
import {
  insertLockEvent,
  insertMarket,
  insertMarketState,
  insertResolution,
  insertRedemption,
  insertTrade,
  insertRewardEvent,
  insertStakeEvent,
  insertSponsoredLock,
  insertSurplusWithdrawal,
  marketExists,
  getActiveMarketIds
} from "./db.js";
import { resolveAndStoreProfiles } from "./contextProfiles.js";
import { env } from "./env.js";

const marketInterface = new Interface(predictionMarketAbi as any);
const vaultInterface = new Interface(vaultAbi as any);
export const rewardDistributorInterface = new Interface(rewardDistributorAbi as any);
export const erc20Interface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

export const TRANSFER_TOPIC = erc20Interface.getEvent("Transfer")!.topicHash;

const profileQueue = new Set<string>();
const pendingMarketState = new Map<string, number>();
const blockTimestampCache = new Map<number, number>();
const inflightBlockFetches = new Map<number, Promise<number>>();
const snapshotLastSeen = new Map<string, number>();
const BLOCK_RPC_CONCURRENCY = Math.max(1, Number(process.env.BLOCK_RPC_CONCURRENCY ?? '2'));
const SNAPSHOT_DEBOUNCE_SECONDS = Math.max(0, Number(process.env.MARKET_SNAPSHOT_DEBOUNCE_SECONDS ?? '120'));
const SHOULD_SCRAPE_PROFILES = (process.env.PROFILE_SCRAPE ?? 'true').toLowerCase() !== 'false';
let activeBlockRequests = 0;
const blockRequestQueue: Array<() => void> = [];
const ZERO_HEX_32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_TX_HASH = ZERO_HEX_32;

export function normalizeEpochId(value: any): string {
  if (value === undefined || value === null) return "";
  const raw = value?.toString?.() ?? String(value);
  if (!raw) return "";
  try {
    return BigInt(raw).toString();
  } catch (error) {
    return raw;
  }
}

export function normalizeHex(value: any): `0x${string}` | undefined {
  if (value === undefined || value === null) return undefined;
  let str = String(value).trim();
  if (!str) return undefined;
  if (!str.startsWith("0x") && !str.startsWith("0X")) {
    if (/^[0-9a-fA-F]+$/.test(str)) {
      str = `0x${str}`;
    } else {
      return undefined;
    }
  }
  return str.toLowerCase() as `0x${string}`;
}

export function normalizeTxHash(value: any): string {
  return normalizeHex(value) ?? ZERO_TX_HASH;
}

function toAmountString(value: any): string | null {
  if (value === undefined || value === null) return null;
  const raw = value?.toString?.() ?? String(value);
  if (!raw) return null;
  try {
    return BigInt(raw).toString();
  } catch (error) {
    return raw;
  }
}

function sumAmounts(values: string[]): bigint {
  return values.reduce<bigint>((acc, entry) => {
    try {
      return acc + BigInt(entry);
    } catch (error) {
      return acc;
    }
  }, 0n);
}

function markMarketSnapshot(marketId: string, ts: number, force = false) {
  if (!force && SNAPSHOT_DEBOUNCE_SECONDS > 0) {
    const last = snapshotLastSeen.get(marketId) ?? 0;
    if (ts <= last + SNAPSHOT_DEBOUNCE_SECONDS) {
      return;
    }
  }
  pendingMarketState.set(marketId, ts);
}

function ensureMarketPresent(marketId: string, ts: number): boolean {
  if (!marketExists(marketId)) {
    return false;
  }
  markMarketSnapshot(marketId, ts);
  return true;
}

function scheduleBlockFetch<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeBlockRequests++;
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeBlockRequests--;
          const next = blockRequestQueue.shift();
          if (next) next();
        });
    };

    if (activeBlockRequests < BLOCK_RPC_CONCURRENCY) {
      run();
    } else {
      blockRequestQueue.push(run);
    }
  });
}

function isRateLimitError(error: any): boolean {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const code = error?.code ?? error?.error?.code;
  return code === -32016 || message.includes('rate') || message.includes('limit');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBlockTimestamp(provider: JsonRpcProvider, blockNumber: number): Promise<number> {
  let delay = 250;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const block = await provider.getBlock(blockNumber);
      if (!block) {
        throw new Error(`block ${blockNumber} not found`);
      }
      const ts = Number(block.timestamp ?? 0);
      if (!Number.isFinite(ts) || ts <= 0) {
        throw new Error(`invalid timestamp for block ${blockNumber}`);
      }
      return ts;
    } catch (error) {
      if (isRateLimitError(error)) {
        await sleep(delay);
        delay = Math.min(delay * 2, 8000);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`getBlock rate-limited too long at ${blockNumber}`);
}

export function enqueueProfile(addr: string | undefined) {
  if (!SHOULD_SCRAPE_PROFILES) return;
  if (!addr) return;
  try {
    const normalized = getAddress(addr);
    profileQueue.add(normalized.toLowerCase());
  } catch (error) {
    // ignore malformed
  }
}

export async function blockTimestamp(provider: JsonRpcProvider, blockNumber: number): Promise<number> {
  if (blockTimestampCache.has(blockNumber)) {
    return blockTimestampCache.get(blockNumber)!;
  }
  let task = inflightBlockFetches.get(blockNumber);
  if (!task) {
    task = scheduleBlockFetch(() => fetchBlockTimestamp(provider, blockNumber));
    inflightBlockFetches.set(blockNumber, task);
  }
  try {
    const ts = await task;
    blockTimestampCache.set(blockNumber, ts);
    if (blockTimestampCache.size > 2048) {
      blockTimestampCache.clear();
    }
    return ts;
  } finally {
    inflightBlockFetches.delete(blockNumber);
  }
}

export function toLower(value: string | undefined | null): string | undefined {
  return value ? value.toLowerCase() : undefined;
}

export async function handleMarketLog(provider: JsonRpcProvider, log: Log) {
  let parsed: any;
  try {
    parsed = marketInterface.parseLog(log as any) as any;
  } catch (error) {
    return;
  }

  const eventName = parsed?.name ?? parsed?.fragment?.name;
  if (!eventName) return;

  const blockNum = typeof log.blockNumber === "number" ? log.blockNumber : Number(log.blockNumber ?? 0);
  const ts = await blockTimestamp(provider, blockNum);

  const marketId = normalizeHex(parsed?.args?.marketId);
  const txHash = normalizeTxHash(log.transactionHash);
  const logIndex = Number((log as any).logIndex ?? (log as any).index ?? 0);

  switch (eventName) {
    case "MarketCreated": {
      if (!marketId) break;
      const creator = toLower(parsed?.args?.creator) as `0x${string}` | undefined;
      const oracle = toLower(parsed?.args?.oracle) as `0x${string}` | undefined;
      const surplusRecipient = toLower(parsed?.args?.surplusRecipient) as `0x${string}` | undefined;
      if (!creator || !oracle || !surplusRecipient) break;

      const metadata = parsed?.args?.metadata ? String(parsed.args.metadata) : null;
      const outcomeNames = Array.isArray(parsed?.args?.outcomeNames)
        ? (parsed.args.outcomeNames as string[])
        : [];
      const questionId = normalizeHex(parsed?.args?.questionId) ?? (ZERO_HEX_32 as `0x${string}`);

      insertMarket({
        marketId,
        creator: creator as `0x${string}`,
        oracle: oracle as `0x${string}`,
        surplusRecipient: surplusRecipient as `0x${string}`,
        questionId,
        outcomeNames,
        metadata: metadata as any,
        txHash: normalizeTxHash(log.transactionHash) as `0x${string}`,
        createdAt: ts
      });

      enqueueProfile(creator);
      enqueueProfile(oracle);
      enqueueProfile(surplusRecipient);
      ensureMarketPresent(marketId, ts);
      break;
    }
    case "MarketTraded": {
      if (!marketId) break;
      const trader = toLower(parsed?.args?.trader);
      if (!trader) break;
      ensureMarketPresent(marketId, ts);
      const usdcFlow = BigInt(parsed?.args?.usdcFlow?.toString?.() ?? parsed?.args?.usdcFlow ?? 0n);
      const usdcIn = usdcFlow > 0n ? usdcFlow : 0n;
      const usdcOut = usdcFlow < 0n ? -usdcFlow : 0n;
      insertTrade({
        ts,
        blockNumber: blockNum,
        marketId,
        txHash,
        logIndex,
        trader,
        usdcIn,
        usdcOut
      });
      enqueueProfile(trader);
      break;
    }
    case "MarketResolved": {
      if (!marketId) break;
      ensureMarketPresent(marketId, ts);
      const surplus = BigInt(parsed?.args?.surplus?.toString?.() ?? parsed?.args?.surplus ?? 0n);
      const payoutsRaw = Array.isArray(parsed?.args?.payoutPcts) ? parsed.args.payoutPcts : [];
      const payout = payoutsRaw.map((value: any) => BigInt(value?.toString?.() ?? value ?? 0));
      insertResolution({ marketId, ts, surplus, payout });
      break;
    }
    case "TokensRedeemed": {
      if (!marketId) break;
      ensureMarketPresent(marketId, ts);
      const redeemer = toLower(parsed?.args?.redeemer);
      const token = toLower(parsed?.args?.token);
      if (!redeemer || !token) break;
      const shares = BigInt(parsed?.args?.shares?.toString?.() ?? parsed?.args?.shares ?? 0n);
      const payout = BigInt(parsed?.args?.payout?.toString?.() ?? parsed?.args?.payout ?? 0n);
      insertRedemption({
        ts,
        marketId,
        user: redeemer,
        token,
        shares,
        payout,
        txHash,
        logIndex
      });
      enqueueProfile(redeemer);
      break;
    }
    case "SurplusWithdrawn": {
      const toAddr = toLower(parsed?.args?.to);
      const amount = toAmountString(parsed?.args?.amount);
      if (!toAddr || !amount) break;
      insertSurplusWithdrawal({
        txHash,
        logIndex,
        toAddr,
        amount,
        blockNumber: blockNum,
        ts
      });
      enqueueProfile(toAddr);
      break;
    }
    default:
      break;
  }
}

export async function handleVaultLog(provider: JsonRpcProvider, log: Log) {
  let parsed;
  try {
    parsed = vaultInterface.parseLog(log);
  } catch (error) {
    return;
  }

  const eventName = parsed?.name ?? parsed?.fragment?.name;
  if (!eventName) return;

  const blockNum = typeof log.blockNumber === "number" ? log.blockNumber : Number(log.blockNumber ?? 0);
  const ts = await blockTimestamp(provider, blockNum);

  const marketId = normalizeHex(parsed?.args?.marketId);
  const user = toLower(parsed?.args?.locker ?? parsed?.args?.staker ?? parsed?.args?.user);
  enqueueProfile(user);
  const txHash = normalizeTxHash(log.transactionHash);
  const logIndex = Number((log as any).logIndex ?? (log as any).index ?? 0);

  switch (eventName) {
    case "LockUpdated":
    case "Unlocked": {
      if (!marketId || !user) break;
      ensureMarketPresent(marketId, ts);
      const amountsRaw = Array.isArray(parsed?.args?.amounts) ? parsed.args.amounts : [];
      const amounts = amountsRaw.map((v: any) => toAmountString(v) ?? '0');
      const total = sumAmounts(amounts);
      const kind = eventName === "Unlocked" ? "unlock" : "lock";
      insertLockEvent({
        txHash,
        logIndex,
        marketId,
        locker: user,
        kind,
        amounts,
        blockNumber: blockNum,
        ts,
        payload: { amounts, total: total.toString(), event: eventName }
      });
      break;
    }
    case "StakeUpdated": {
      if (!marketId || !user) break;
      ensureMarketPresent(marketId, ts);
      const amountsRaw = Array.isArray(parsed?.args?.amounts) ? parsed.args.amounts : [];
      const amounts = amountsRaw.map((v: any) => toAmountString(v) ?? '0');
      insertStakeEvent({
        txHash,
        logIndex,
        marketId,
        staker: user,
        amounts,
        blockNumber: blockNum,
        ts
      });
      break;
    }
    case "SponsoredLocked": {
      if (!marketId || !user) break;
      ensureMarketPresent(marketId, ts);
      const setsAmount = toAmountString(parsed?.args?.setsAmount);
      const userPaid = toAmountString(parsed?.args?.userPaid);
      const subsidyUsed = toAmountString(parsed?.args?.subsidyUsed);
      const actualCost = toAmountString(parsed?.args?.actualCost);
      insertSponsoredLock({
        txHash,
        logIndex,
        marketId,
        user,
        setsAmount,
        userPaid,
        subsidyUsed,
        actualCost,
        outcomes: parsed?.args?.outcomes ? Number(parsed.args.outcomes) : null,
        nonce: parsed?.args?.nonce ? String(parsed.args.nonce) : null,
        blockNumber: blockNum,
        ts
      });
      break;
    }
    default:
      break;
  }
}

export async function flushProfiles() {
  if (!profileQueue.size) return;
  if (!process.env.PROFILE_SCRAPE || process.env.PROFILE_SCRAPE === "false") {
    profileQueue.clear();
    return;
  }
  const addresses = Array.from(profileQueue);
  profileQueue.clear();
  try {
    await resolveAndStoreProfiles(addresses);
  } catch (error) {
    for (const addr of addresses) profileQueue.add(addr);
  }
}

async function updateMarketState(provider: JsonRpcProvider, marketId: string, ts: number) {
  try {
    const data = marketInterface.encodeFunctionData("getMarketInfo", [marketId]);
    const result = await provider.call({ to: env.predictionMarket, data });
    const decoded = marketInterface.decodeFunctionResult("getMarketInfo", result) as any;

    const alpha = BigInt(decoded?.alpha?.toString?.() ?? decoded?.[3]?.toString?.() ?? 0n);
    const totalUsdc = BigInt(decoded?.totalUsdcIn?.toString?.() ?? decoded?.[4]?.toString?.() ?? 0n);
    const outcomeQsRaw = decoded?.outcomeQs ?? decoded?.[8] ?? [];
    const totalQ = (Array.isArray(outcomeQsRaw) ? outcomeQsRaw : []).reduce<bigint>((acc, value) => {
      try {
        return acc + BigInt(value?.toString?.() ?? value ?? 0);
      } catch (error) {
        return acc;
      }
    }, 0n);

    insertMarketState({ marketId, ts, totalUsdc, totalQ, alpha });
    snapshotLastSeen.set(marketId, ts);
  } catch (error) {
    console.warn("market state refresh failed", marketId, error);
  }
}

export async function flushPendingMarketStates(provider: JsonRpcProvider) {
  if (!pendingMarketState.size) return;
  const entries = Array.from(pendingMarketState.entries());
  pendingMarketState.clear();
  for (const [marketId, ts] of entries) {
    await updateMarketState(provider, marketId, ts);
  }
}

export async function queueResnapshotForActiveMarkets(ts?: number) {
  const at = ts ?? Math.floor(Date.now() / 1000);
  const marketIds = getActiveMarketIds();
  for (const marketId of marketIds) {
    markMarketSnapshot(marketId, at, true);
  }
}
