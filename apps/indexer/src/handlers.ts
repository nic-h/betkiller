import { JsonRpcProvider, Interface, Log, getAddress } from "ethers";
import { predictionMarketAbi, vaultAbi } from "./abi.js";
import {
  insertLockEvent,
  insertMarket,
  insertMarketState,
  insertResolution,
  insertRedemption,
  insertTrade,
  insertRewardClaim,
  insertMarketStub,
  marketExists
} from "./db.js";
import { resolveAndStoreProfiles } from "./contextProfiles.js";
import { env } from "./env.js";

const marketInterface = new Interface(predictionMarketAbi as any);
const vaultInterface = new Interface(vaultAbi as any);
const erc20Interface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

export const TRANSFER_TOPIC = erc20Interface.getEvent("Transfer")!.topicHash;

const profileQueue = new Set<string>();
const pendingMarketState = new Map<string, number>();
const blockTimestampCache = new Map<number, number>();
const ZERO_HEX_32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_TX_HASH = ZERO_HEX_32;

function normalizeHex(value: any): `0x${string}` | undefined {
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

function normalizeTxHash(value: any): string {
  return normalizeHex(value) ?? ZERO_TX_HASH;
}

function ensureMarketPresent(marketId: string, ts: number) {
  if (!marketExists(marketId)) {
    insertMarketStub(marketId, ts);
  }
  pendingMarketState.set(marketId, ts);
}

function enqueueProfile(addr: string | undefined) {
  if (!addr) return;
  try {
    const normalized = getAddress(addr);
    profileQueue.add(normalized.toLowerCase());
  } catch (error) {
    // ignore malformed
  }
}

async function blockTimestamp(provider: JsonRpcProvider, blockNumber: number): Promise<number> {
  if (blockTimestampCache.has(blockNumber)) {
    return blockTimestampCache.get(blockNumber)!;
  }
  const block = await provider.getBlock(blockNumber);
  const ts = Number(block?.timestamp ?? Math.floor(Date.now() / 1000));
  blockTimestampCache.set(blockNumber, ts);
  if (blockTimestampCache.size > 512) {
    blockTimestampCache.clear();
  }
  return ts;
}

function toLower(value: string | undefined | null): string | undefined {
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
        marketId,
        txHash: normalizeTxHash(log.transactionHash),
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
        txHash: normalizeTxHash(log.transactionHash),
        logIndex: Number((log as any).logIndex ?? (log as any).index ?? 0)
      });
      enqueueProfile(redeemer);
      break;
    }
    default:
      if (marketId) {
        ensureMarketPresent(marketId, ts);
      }
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

  switch (eventName) {
    case "LockUpdated":
    case "Unlocked":
    case "StakeUpdated": {
      if (!marketId || !user) break;
      ensureMarketPresent(marketId, ts);
      const amountsRaw = Array.isArray(parsed?.args?.amounts) ? parsed.args.amounts : [];
      const amounts = amountsRaw.map((v: any) => v?.toString?.() ?? String(v ?? 0));
      insertLockEvent({
        ts,
        marketId,
        user,
        type: eventName.toLowerCase().replace("updated", ""),
        payload: { amounts }
      });
      break;
    }
    case "SponsoredLocked": {
      if (!marketId || !user) break;
      ensureMarketPresent(marketId, ts);
      insertLockEvent({
        ts,
        marketId,
        user,
        type: "sponsored",
        payload: {
          setsAmount: parsed?.args?.setsAmount ? String(parsed.args.setsAmount) : null,
          userPaid: parsed?.args?.userPaid ? String(parsed.args.userPaid) : null,
          subsidyUsed: parsed?.args?.subsidyUsed ? String(parsed.args.subsidyUsed) : null,
          actualCost: parsed?.args?.actualCost ? String(parsed.args.actualCost) : null,
          outcomes: parsed?.args?.outcomes ? Number(parsed.args.outcomes) : null,
          nonce: parsed?.args?.nonce ? String(parsed.args.nonce) : null
        }
      });
      break;
    }
    default:
      break;
  }
}

export async function handleRewardTransferLog(provider: JsonRpcProvider, log: Log) {
  let parsed: any;
  try {
    parsed = erc20Interface.parseLog(log as any) as any;
  } catch (error) {
    return;
  }

  const fromAddr = toLower(parsed?.args?.from);
  const toAddr = toLower(parsed?.args?.to);
  if (!fromAddr || !toAddr) return;

  const blockNum = typeof log.blockNumber === "number" ? log.blockNumber : Number(log.blockNumber ?? 0);
  const ts = await blockTimestamp(provider, blockNum);
  const amount = BigInt(parsed?.args?.value?.toString?.() ?? parsed?.args?.value ?? 0n);

  insertRewardClaim({
    txHash: normalizeTxHash(log.transactionHash),
    logIndex: Number((log as any).logIndex ?? (log as any).index ?? 0),
    ts,
    user: toAddr,
    amount
  });
  enqueueProfile(toAddr);
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
