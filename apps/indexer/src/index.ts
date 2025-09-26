import pino from "pino";
import { JsonRpcProvider } from "ethers";
import { Hex, createPublicClient, decodeEventLog, getAddress, http } from "viem";
import { base } from "viem/chains";
import {
  db,
  getLastProcessedBlock,
  insertLockEvent,
  insertMarket,
  insertPrice,
  insertRewardEvent,
  insertTrade,
  replaceImpactRows,
  setLastProcessedBlock
} from "./db.js";
import { env } from "./env.js";
import { blockForDaysAgo } from "./findStartBlock.js";
import { resolveAndStoreProfiles } from "./contextProfiles.js";
import { predictionMarketAbi, vaultAbi, rewardDistributorAbi } from "./abi.js";

const logger = (pino as any)({ level: process.env.LOG_LEVEL ?? "info" });

const client = createPublicClient({
  chain: base,
  transport: http(env.baseRpc)
});

const provider = new JsonRpcProvider(env.baseRpc);

const USDC_DECIMALS = 6n;
const PROB_SCALE = Number(10n ** USDC_DECIMALS);
const IMPACT_USDC_CLIPS: bigint[] = [25n, 50n, 100n, 250n].map((v) => v * 10n ** USDC_DECIMALS);
const LOG_BATCH_SIZE = BigInt(process.env.LOG_BATCH_SIZE ?? "500");
const PRICE_BATCH_SIZE = Math.max(1, Number(process.env.PRICE_BATCH_SIZE ?? 20));
const META_UPDATE_INTERVAL = BigInt(process.env.META_UPDATE_INTERVAL ?? "50");

const pendingProfiles = new Set<string>();
const blockTimestampCache = new Map<bigint, number>();
const BLOCK_CACHE_LIMIT = 2048;

const knownMarketsRows = db.prepare("SELECT marketId FROM markets").all() as { marketId: string }[];
const knownMarkets = new Set<string>(knownMarketsRows.map((row) => row.marketId));
let priceCursor = 0;

function enqueueProfile(address: string | undefined) {
  if (!address) return;
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return;
  pendingProfiles.add(address.toLowerCase());
}

async function flushProfiles() {
  if (pendingProfiles.size === 0) return;
  const addresses = Array.from(pendingProfiles);
  pendingProfiles.clear();
  try {
    await resolveAndStoreProfiles(addresses);
  } catch (error) {
    addresses.forEach((addr) => pendingProfiles.add(addr));
    logger.warn({ err: error }, "profile enrichment failed");
  }
}

async function getBlockTimestamp(blockNumber: bigint): Promise<number> {
  if (blockTimestampCache.has(blockNumber)) {
    return blockTimestampCache.get(blockNumber)!;
  }
  const block = await client.getBlock({ blockNumber });
  const ts = Number(block.timestamp);
  blockTimestampCache.set(blockNumber, ts);
  if (blockTimestampCache.size > BLOCK_CACHE_LIMIT) {
    blockTimestampCache.clear();
  }
  return ts;
}

async function processPredictionMarketLogs(logs: any[]) {
  for (const log of logs) {
    let decoded: any;
    try {
      decoded = decodeEventLog({ abi: predictionMarketAbi, data: log.data, topics: log.topics });
    } catch (error) {
      logger.warn({ err: error, txHash: log.transactionHash }, "failed to decode prediction market log");
      continue;
    }

    const eventArgs = (decoded?.args ?? {}) as any;
    const blockNumber: bigint = log.blockNumber;
    const timestamp = await getBlockTimestamp(blockNumber);

    if (decoded?.eventName === "MarketCreated") {
      const marketIdRaw = eventArgs.marketId as Hex | undefined;
      const creatorRaw = eventArgs.creator as Hex | undefined;
      const oracleRaw = eventArgs.oracle as Hex | undefined;
      const surplusRaw = eventArgs.surplusRecipient as Hex | undefined;
      if (!marketIdRaw || !creatorRaw || !oracleRaw || !surplusRaw) continue;

      const marketId = (marketIdRaw as string).toLowerCase() as `0x${string}`;
      const creator = getAddress(creatorRaw as Hex).toLowerCase();
      const oracle = getAddress(oracleRaw as Hex).toLowerCase();
      const surplusRecipient = getAddress(surplusRaw as Hex).toLowerCase();
      const questionId = (eventArgs.questionId ?? "0x" + "0".repeat(64)) as Hex;
      const metadata = (eventArgs.metadata as Hex | undefined) ?? null;
      const outcomeNames = Array.isArray(eventArgs.outcomeNames) ? (eventArgs.outcomeNames as string[]) : [];

      insertMarket({
        marketId,
        creator: creator as `0x${string}`,
        oracle: oracle as `0x${string}`,
        surplusRecipient: surplusRecipient as `0x${string}`,
        questionId,
        outcomeNames,
        metadata,
        txHash: log.transactionHash,
        createdAt: timestamp
      });

      knownMarkets.add(marketId);
      enqueueProfile(creator);
      enqueueProfile(oracle);
      enqueueProfile(surplusRecipient);
    } else if (decoded?.eventName === "MarketTraded") {
      const marketIdRaw = eventArgs.marketId as Hex | undefined;
      const traderRaw = eventArgs.trader as Hex | undefined;
      if (!marketIdRaw || !traderRaw) continue;
      const marketId = (marketIdRaw as string).toLowerCase();
      const trader = getAddress(traderRaw as Hex).toLowerCase();
      const costDelta = BigInt(eventArgs.costDelta ?? 0n);
      const usdcIn = costDelta > 0n ? costDelta : 0n;
      const usdcOut = costDelta < 0n ? -costDelta : 0n;

      insertTrade({
        ts: timestamp,
        marketId,
        txHash: log.transactionHash,
        trader,
        usdcIn,
        usdcOut
      });

      enqueueProfile(trader);
    }
  }
}

async function processVaultLogs(logs: any[]) {
  for (const log of logs) {
    let decoded: any;
    try {
      decoded = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics });
    } catch (error) {
      logger.warn({ err: error, txHash: log.transactionHash }, "failed to decode vault log");
      continue;
    }

    const eventArgs = (decoded?.args ?? {}) as any;
    const timestamp = await getBlockTimestamp(log.blockNumber);

    switch (decoded?.eventName) {
      case "LockUpdated": {
        const locker = eventArgs.locker ? getAddress(eventArgs.locker as Hex) : undefined;
        const marketId = typeof eventArgs.marketId === "string" ? (eventArgs.marketId as string).toLowerCase() : "";
        const amounts = Array.isArray(eventArgs.amounts) ? (eventArgs.amounts as bigint[]).map((v) => v.toString()) : [];
        if (!locker || !marketId) break;
        insertLockEvent({
          ts: timestamp,
          marketId,
          user: locker,
          type: "lock",
          payload: { amounts }
        });
        enqueueProfile(locker);
        break;
      }
      case "StakeUpdated": {
        const staker = eventArgs.staker ? getAddress(eventArgs.staker as Hex) : undefined;
        const marketId = typeof eventArgs.marketId === "string" ? (eventArgs.marketId as string).toLowerCase() : "";
        const amounts = Array.isArray(eventArgs.amounts) ? (eventArgs.amounts as bigint[]).map((v) => v.toString()) : [];
        if (!staker || !marketId) break;
        insertLockEvent({
          ts: timestamp,
          marketId,
          user: staker,
          type: "stake",
          payload: { amounts }
        });
        enqueueProfile(staker);
        break;
      }
      case "Unlocked": {
        const locker = eventArgs.locker ? getAddress(eventArgs.locker as Hex) : undefined;
        const marketId = typeof eventArgs.marketId === "string" ? (eventArgs.marketId as string).toLowerCase() : "";
        const amounts = Array.isArray(eventArgs.amounts) ? (eventArgs.amounts as bigint[]).map((v) => v.toString()) : [];
        if (!locker || !marketId) break;
        insertLockEvent({
          ts: timestamp,
          marketId,
          user: locker,
          type: "unlock",
          payload: { amounts }
        });
        enqueueProfile(locker);
        break;
      }
      case "SponsoredLocked": {
        const user = eventArgs.user ? getAddress(eventArgs.user as Hex) : undefined;
        const marketId = typeof eventArgs.marketId === "string" ? (eventArgs.marketId as string).toLowerCase() : "";
        if (!user || !marketId) break;
        insertLockEvent({
          ts: timestamp,
          marketId,
          user,
          type: "sponsored",
          payload: {
            setsAmount: eventArgs.setsAmount ? String(eventArgs.setsAmount) : null,
            userPaid: eventArgs.userPaid ? String(eventArgs.userPaid) : null,
            subsidyUsed: eventArgs.subsidyUsed ? String(eventArgs.subsidyUsed) : null,
            actualCost: eventArgs.actualCost ? String(eventArgs.actualCost) : null,
            outcomes: typeof eventArgs.outcomes === "number" ? eventArgs.outcomes : Number(eventArgs.outcomes ?? 0),
            nonce: eventArgs.nonce ? String(eventArgs.nonce) : null
          }
        });
        enqueueProfile(user);
        break;
      }
      default:
        break;
    }
  }
}

async function processRewardLogs(logs: any[]) {
  for (const log of logs) {
    let decoded: any;
    try {
      decoded = decodeEventLog({ abi: rewardDistributorAbi, data: log.data, topics: log.topics });
    } catch (error) {
      logger.warn({ err: error, txHash: log.transactionHash }, "failed to decode reward log");
      continue;
    }

    const eventArgs = (decoded?.args ?? {}) as any;
    const timestamp = await getBlockTimestamp(log.blockNumber);

    if (decoded?.eventName === "EpochRootSet") {
      insertRewardEvent({
        ts: timestamp,
        kind: "root",
        epochId: eventArgs.epochId ? String(eventArgs.epochId) : "0",
        root: eventArgs.merkleRoot ?? null
      });
    } else if (decoded?.eventName === "RewardClaimed") {
      const user = eventArgs.user ? (eventArgs.user as string) : undefined;
      insertRewardEvent({
        ts: timestamp,
        kind: "claim",
        epochId: eventArgs.epochId ? String(eventArgs.epochId) : "0",
        user: user ?? null,
        amount: eventArgs.amount != null ? BigInt(eventArgs.amount) : null
      });
      if (user) enqueueProfile(user);
    }
  }
}

async function processRange(fromBlock: bigint, toBlock: bigint) {
  const pmLogs = await client.getLogs({
    address: env.predictionMarket as Hex,
    fromBlock,
    toBlock
  });
  const vaultLogs = await client.getLogs({
    address: env.vault as Hex,
    fromBlock,
    toBlock
  });
  const rewardLogs = await client.getLogs({
    address: env.rewardDistributor as Hex,
    fromBlock,
    toBlock
  });

  await processPredictionMarketLogs(pmLogs);
  await processVaultLogs(vaultLogs);
  await processRewardLogs(rewardLogs);
  await flushProfiles();

  logger.debug({ from: fromBlock.toString(), to: toBlock.toString() }, "processed block range");
}

async function syncLoop() {
  const boundary = BigInt(await blockForDaysAgo(provider, env.lookbackDays));
  let lastPersisted = getLastProcessedBlock("last_block_synced");
  let cursor = lastPersisted ?? boundary - 1n;
  if (cursor < boundary - 1n) {
    cursor = boundary - 1n;
  }
  let lastMetaWrite = lastPersisted ?? cursor;

  logger.info({ from: (cursor + 1n).toString(), lookbackDays: env.lookbackDays }, "starting historical sync");

  while (true) {
    const head = await client.getBlockNumber();
    if (cursor < head) {
      const fromBlock = cursor + 1n;
      const plannedUpper = fromBlock + LOG_BATCH_SIZE - 1n;
      const toBlock = plannedUpper > head ? head : plannedUpper;

      await processRange(fromBlock, toBlock);
      cursor = toBlock;

      if (cursor - lastMetaWrite >= META_UPDATE_INTERVAL || cursor === head) {
        setLastProcessedBlock("last_block_synced", cursor);
        lastMetaWrite = cursor;
      }
    } else {
      await wait(5_000);
    }
  }
}

async function refreshPricesAndImpact() {
  const markets = Array.from(knownMarkets);
  if (markets.length === 0) return;
  if (priceCursor >= markets.length) {
    priceCursor = 0;
  }
  const batchCount = Math.min(PRICE_BATCH_SIZE, markets.length);
  const selected: string[] = [];
  for (let i = 0; i < batchCount; i++) {
    const index = (priceCursor + i) % markets.length;
    selected.push(markets[index]);
  }
  priceCursor = (priceCursor + batchCount) % markets.length;

  const now = Math.floor(Date.now() / 1000);
  for (const marketId of selected) {
    try {
      const prices = (await client.readContract({
        address: env.predictionMarket as Hex,
        abi: predictionMarketAbi,
        functionName: "getPrices",
        args: [marketId as `0x${string}`]
      })) as bigint[];

      insertPrice({ ts: now, marketId, prices });

      await recomputeImpact(marketId as `0x${string}`, prices, now);
    } catch (error) {
      logger.warn({ err: error, marketId }, "failed to refresh prices");
    }
  }
}

async function recomputeImpact(marketId: `0x${string}`, basePrices: bigint[], ts: number) {
  try {
    const info = (await client.readContract({
      address: env.predictionMarket as Hex,
      abi: predictionMarketAbi,
      functionName: "getMarketInfo",
      args: [marketId]
    })) as unknown as {
      alpha: bigint;
      outcomeQs: bigint[];
    };

    if (!info || info.outcomeQs.length === 0) return;

    let topIndex = 0;
    for (let i = 1; i < basePrices.length; i++) {
      if (basePrices[i] > basePrices[topIndex]) {
        topIndex = i;
      }
    }

    const impactRows: { usdcClip: bigint; deltaProb: number; ts: number }[] = [];

    for (const clip of IMPACT_USDC_CLIPS) {
      const shares = await findSharesForCost(info.outcomeQs, info.alpha, topIndex, clip);
      if (!shares) continue;

      const newQs = info.outcomeQs.map((q, idx) => (idx === topIndex ? q + shares : q));

      const newPrices = (await client.readContract({
        address: env.predictionMarket as Hex,
        abi: predictionMarketAbi,
        functionName: "calcPrice",
        args: [newQs, info.alpha]
      })) as bigint[];

      const delta = Number(newPrices[topIndex] - basePrices[topIndex]) / PROB_SCALE;
      impactRows.push({ usdcClip: clip, deltaProb: delta, ts });
    }

    if (impactRows.length > 0) {
      replaceImpactRows(marketId, impactRows);
    }
  } catch (error) {
    logger.warn({ err: error, marketId }, "failed to compute impact");
  }
}

async function findSharesForCost(qs: bigint[], alpha: bigint, index: number, targetCost: bigint): Promise<bigint | null> {
  if (targetCost === 0n) return 0n;

  const quote = async (shares: bigint) => {
    const deltas = qs.map((_, idx) => (idx === index ? shares : 0n));
    const cost = (await client.readContract({
      address: env.predictionMarket as Hex,
      abi: predictionMarketAbi,
      functionName: "quoteTrade",
      args: [qs, alpha, deltas]
    })) as bigint;
    return cost >= 0n ? cost : -cost;
  };

  let low = 0n;
  let high = 1n;
  const maxShare = 10n ** 12n;

  while (true) {
    const cost = await quote(high);
    if (cost >= targetCost || high >= maxShare) break;
    low = high;
    high *= 2n;
  }

  if (high >= maxShare) {
    return null;
  }

  while (low + 1n < high) {
    const mid = (low + high) / 2n;
    const cost = await quote(mid);
    if (cost >= targetCost) {
      high = mid;
    } else {
      low = mid;
    }
  }

  return high;
}

async function pricesLoop() {
  while (true) {
    try {
      await refreshPricesAndImpact();
    } catch (error) {
      logger.error({ err: error }, "price loop failure");
    }
    await wait(10_000);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await Promise.all([syncLoop(), pricesLoop()]);
