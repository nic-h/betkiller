import pino from "pino";
import { JsonRpcProvider } from "ethers";
import {
  Hex,
  Log,
  Transaction,
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  http
} from "viem";
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
import { computeMarketId } from "./helpers.js";
import { blockForDaysAgo } from "./findStartBlock.js";
import { resolveAndStoreProfiles } from "./contextProfiles.js";
import { predictionMarketAbi, vaultAbi, rewardDistributorAbi, erc20Abi } from "./abi.js";

const logger = (pino as any)({ level: process.env.LOG_LEVEL ?? "info" });

const client = createPublicClient({
  chain: base,
  transport: http(env.baseRpc)
});

const provider = new JsonRpcProvider(env.baseRpc);

const USDC_DECIMALS = 6n;
const PROB_SCALE = Number(10n ** USDC_DECIMALS);
const IMPACT_USDC_CLIPS: bigint[] = [25n, 50n, 100n, 250n].map((v) => v * 10n ** USDC_DECIMALS);

const pendingProfiles = new Set<string>();


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
const knownMarketsRows = db.prepare("SELECT marketId FROM markets").all() as { marketId: string }[];
const knownMarkets = new Set<string>(knownMarketsRows.map((row) => row.marketId));

async function processBlock(blockNumber: bigint) {
  const block = await client.getBlock({ blockNumber, includeTransactions: true }) as any;
  const blockTs = Number(block.timestamp);

  for (const tx of block.transactions) {
    if (!tx.to) continue;
    if (tx.to.toLowerCase() !== env.predictionMarket) continue;
    await handlePredictionMarketTx(tx, blockTs);
  }

  await processVaultLogs(blockNumber, blockTs);
  await processRewardLogs(blockNumber, blockTs);
  await flushProfiles();

  setLastProcessedBlock("last_block_synced", blockNumber);
}

async function handlePredictionMarketTx(tx: any, blockTs: number) {
  let decoded: any;
  try {
    decoded = decodeFunctionData({ abi: predictionMarketAbi, data: tx.input }) as any;
  } catch (error) {
    return;
  }

  const fnName: string = decoded?.functionName ?? "";
  const args: any[] = decoded?.args ?? [];

  if (fnName === "createMarket") {
    await handleCreateMarket(tx, args, blockTs);
  } else if (fnName === "trade") {
    await handleTrade(tx, args, blockTs);
  }
}

async function handleCreateMarket(tx: any, args: unknown[], blockTs: number) {
  const [rawParams] = args as [
    {
      oracle?: Hex;
      questionId?: Hex;
      surplusRecipient?: Hex;
      metadata?: Hex;
      outcomeNames?: string[];
    }
  ];
  const params = rawParams ?? ({} as any);

  const creator = getAddress(tx.from);
  const oracle = params.oracle ? getAddress(params.oracle) : creator;
  const surplusRecipient = params.surplusRecipient ? getAddress(params.surplusRecipient) : creator;
  const questionId = (params.questionId ?? "0x" + "0".repeat(64)) as Hex;
  const marketId = computeMarketId(creator, oracle, questionId);
  const normalizedMarketId = (marketId as string).toLowerCase() as Hex;

  if (knownMarkets.has(normalizedMarketId)) {
    return;
  }

  const receipt = await client.getTransactionReceipt({ hash: tx.hash });

  let outcomeNames: string[] = [];
  let metadata: Hex | null = params.metadata && params.metadata !== "0x" ? params.metadata : null;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== env.predictionMarket) continue;
    try {
      const decodedLog = decodeEventLog({
        abi: predictionMarketAbi,
        data: log.data,
        topics: log.topics
      }) as any;
      if (decodedLog?.eventName === "MarketCreated") {
        const eventArgs = decodedLog.args ?? {} as any;
        outcomeNames = (eventArgs.outcomeNames as string[]) ?? [];
        const maybeMetadata = eventArgs.metadata as Hex | undefined;
        if (!metadata && maybeMetadata && maybeMetadata !== "0x") {
          metadata = maybeMetadata;
        }
        break;
      }
    } catch (error) {
      continue;
    }
  }

  insertMarket({
    marketId: normalizedMarketId,
    creator,
    oracle,
    surplusRecipient,
    questionId,
    outcomeNames,
    metadata,
    txHash: tx.hash,
    createdAt: blockTs
  });

  enqueueProfile(creator);
  enqueueProfile(oracle);
  enqueueProfile(surplusRecipient);

  knownMarkets.add(normalizedMarketId);
  logger.info({ marketId }, "indexed new market");
}

async function handleTrade(tx: any, args: unknown[], blockTs: number) {
  const [tradeDataRaw] = args as [
    {
      marketId?: Hex;
    }
  ];
  const tradeData = tradeDataRaw ?? ({} as any);

  const marketId = (tradeData.marketId ?? "0x" + "0".repeat(64)).toLowerCase();

  const receipt = await client.getTransactionReceipt({ hash: tx.hash });

  let usdcIn = 0n;
  let usdcOut = 0n;

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== env.usdc) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics }) as any;
      if (decoded?.eventName !== "Transfer") continue;
      const eventArgs = (decoded?.args ?? {}) as any;
      const from = eventArgs.from ? getAddress(eventArgs.from as Hex).toLowerCase() : "";
      const to = eventArgs.to ? getAddress(eventArgs.to as Hex).toLowerCase() : "";
      const value = eventArgs.value != null ? BigInt(eventArgs.value) : 0n;
      if (!from && !to) continue;
      if (to === env.predictionMarket) {
        usdcIn += value;
      } else if (from === env.predictionMarket) {
        usdcOut += value;
      }
    } catch (error) {
      continue;
    }
  }

  insertTrade({
    ts: blockTs,
    marketId,
    txHash: tx.hash,
    usdcIn,
    usdcOut
  });

  enqueueProfile(tx.from);
}

async function processVaultLogs(blockNumber: bigint, blockTs: number) {
  const logs = await client.getLogs({
    address: env.vault as Hex,
    fromBlock: blockNumber,
    toBlock: blockNumber
  });

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: vaultAbi, data: log.data, topics: log.topics }) as any;
      const eventArgs = (decoded?.args ?? {}) as any;
      switch (decoded?.eventName) {
        case "LockUpdated": {
          const locker = eventArgs.locker ? getAddress(eventArgs.locker as Hex) : undefined;
          const marketId = typeof eventArgs.marketId === "string" ? eventArgs.marketId.toLowerCase() : "";
          const amounts = Array.isArray(eventArgs.amounts) ? (eventArgs.amounts as bigint[]).map((v) => v.toString()) : [];
          if (!locker || !marketId) break;
          insertLockEvent({
            ts: blockTs,
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
          const marketId = typeof eventArgs.marketId === "string" ? eventArgs.marketId.toLowerCase() : "";
          const amounts = Array.isArray(eventArgs.amounts) ? (eventArgs.amounts as bigint[]).map((v) => v.toString()) : [];
          if (!staker || !marketId) break;
          insertLockEvent({
            ts: blockTs,
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
          const marketId = typeof eventArgs.marketId === "string" ? eventArgs.marketId.toLowerCase() : "";
          const amounts = Array.isArray(eventArgs.amounts) ? (eventArgs.amounts as bigint[]).map((v) => v.toString()) : [];
          if (!locker || !marketId) break;
          insertLockEvent({
            ts: blockTs,
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
          const marketId = typeof eventArgs.marketId === "string" ? eventArgs.marketId.toLowerCase() : "";
          if (!user || !marketId) break;
          insertLockEvent({
            ts: blockTs,
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
    } catch (error) {
      logger.warn({ err: error }, "failed to decode vault log");
    }
  }
}

async function processRewardLogs(blockNumber: bigint, blockTs: number) {
  const logs = await client.getLogs({
    address: env.rewardDistributor as Hex,
    fromBlock: blockNumber,
    toBlock: blockNumber
  });

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: rewardDistributorAbi, data: log.data, topics: log.topics }) as any;
      const eventArgs = (decoded?.args ?? {}) as any;
      if (decoded?.eventName === "EpochRootSet") {
        insertRewardEvent({
          ts: blockTs,
          kind: "root",
          epochId: eventArgs.epochId ? String(eventArgs.epochId) : "0",
          root: eventArgs.merkleRoot ?? null
        });
      } else if (decoded?.eventName === "RewardClaimed") {
        const user = eventArgs.user ? getAddress(eventArgs.user as Hex) : undefined;
        insertRewardEvent({
          ts: blockTs,
          kind: "claim",
          epochId: eventArgs.epochId ? String(eventArgs.epochId) : "0",
          user: user ?? null,
          amount: eventArgs.amount != null ? BigInt(eventArgs.amount) : null
        });
        if (user) enqueueProfile(user);
      }
    } catch (error) {
      logger.warn({ err: error }, "failed to decode reward log");
    }
  }
}

async function refreshPricesAndImpact() {
  if (knownMarkets.size === 0) return;

  const now = Math.floor(Date.now() / 1000);

  for (const marketId of knownMarkets) {
    try {
      const prices = (await client.readContract({
        address: env.predictionMarket as Hex,
        abi: predictionMarketAbi,
        functionName: "getPrices",
        args: [marketId as `0x${string}`]
      })) as bigint[];

      insertPrice({ ts: now, marketId, prices });

      await recomputeImpact(marketId as Hex, prices, now);
    } catch (error) {
      logger.warn({ err: error, marketId }, "failed to refresh prices");
    }
  }
}

async function recomputeImpact(marketId: Hex, basePrices: bigint[], ts: number) {
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

    if (info.outcomeQs.length === 0) return;

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

      const deltaShares = info.outcomeQs.map((_, idx) => (idx === topIndex ? shares : 0n));
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

async function syncLoop() {
  const startBoundary = BigInt(await blockForDaysAgo(provider, env.lookbackDays));
  const minCursor = startBoundary > 0n ? startBoundary - 1n : -1n;

  let nextBlock = getLastProcessedBlock("last_block_synced");
  if (typeof nextBlock === "bigint") {
    if (nextBlock < minCursor) {
      nextBlock = minCursor;
    }
  } else {
    nextBlock = minCursor;
  }

  const latest = await client.getBlockNumber();
  logger.info(
    { from: (nextBlock + 1n).toString(), to: latest.toString(), lookbackDays: env.lookbackDays },
    "starting historical sync"
  );

  while (nextBlock < latest) {
    nextBlock += 1n;
    try {
      await processBlock(nextBlock);
    } catch (error) {
      logger.error({ err: error, block: nextBlock.toString() }, "failed processing block");
      throw error;
    }
  }

  logger.info("historical sync complete");

  let cursor = nextBlock;

  while (true) {
    const head = await client.getBlockNumber();
    while (cursor < head) {
      cursor += 1n;
      try {
        await processBlock(cursor);
      } catch (error) {
        logger.error({ err: error, block: cursor.toString() }, "sync error");
        cursor -= 1n;
        await wait(5_000);
        break;
      }
    }
    await wait(5_000);
  }
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
