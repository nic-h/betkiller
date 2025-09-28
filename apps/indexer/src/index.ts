import 'dotenv/config';
import { JsonRpcProvider, Log } from 'ethers';
import { env } from './env.js';
import { db, getIndexerCursor, setIndexerCursor } from './db.js';
import { flushProfiles, flushPendingMarketStates, queueResnapshotForActiveMarkets, TRANSFER_TOPIC } from './handlers.js';
import { handleRewardTransferLog } from './handlers/rewards.js';
import { appendStoredLogs, serializeLog, type StoredLog } from './logStore.js';
import { ingestJsonLogs, bootstrapFromExisting } from './jsonlIngester.js';
import { ensureSeedOnce } from './seed.js';
import { startHttpServer } from './server/index.js';
import { scheduleMentionSync } from './mentionsIngester.js';
import { syncMarketHeuristicsSnapshots } from './heuristicsSnapshot.js';

const RPCS = (process.env.RPC_URLS || process.env.RPC_URL || '')
  .split('|')
  .map((s) => s.trim())
  .filter(Boolean);

if (RPCS.length === 0) {
  throw new Error('Set RPC_URLS or RPC_URL');
}

function makeProvider(index: number) {
  return new JsonRpcProvider(RPCS[index]);
}

let rpcIndex = 0;
let provider = makeProvider(rpcIndex);

const CHAIN_ID = Number(process.env.CHAIN_ID ?? '8453');

const CONFIRMATIONS = Number(process.env.CONFIRMATIONS ?? process.env.FINALITY_LAG_BLOCKS ?? 8);
const STEP = Number(process.env.STEP ?? process.env.CHUNK ?? process.env.LOG_STEP ?? 4000);
const POLL_MS = Number(process.env.POLL_MS ?? 4000);
const BACKFILL_DAYS = Number(process.env.BACKFILL_DAYS ?? env.lookbackDays ?? 14);
const RESNAPSHOT_INTERVAL_MS = Number(process.env.RESNAPSHOT_INTERVAL_MS ?? 24 * 60 * 60 * 1000);

const pmAddress = env.predictionMarket.toLowerCase();
const vaultAddress = env.vault.toLowerCase();
const rewardToken = env.rewardToken?.toLowerCase();
const rewardSources = env.rewardDistributors.map((addr) => addr.toLowerCase());
if (!rewardSources.includes(env.rewardDistributor.toLowerCase())) {
  rewardSources.push(env.rewardDistributor.toLowerCase());
}

let nextResnapshotAt = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetResnapshotSchedule() {
  if (RESNAPSHOT_INTERVAL_MS <= 0) {
    nextResnapshotAt = Number.POSITIVE_INFINITY;
  } else {
    nextResnapshotAt = Date.now() + RESNAPSHOT_INTERVAL_MS;
  }
}

function getMeta(key: string): number {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value?: string } | undefined;
  if (!row?.value) return 0;
  return Number(row.value);
}

function setMeta(key: string, value: number | string) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

function getLastBlock(): number {
  const cursor = getIndexerCursor(CHAIN_ID);
  if (cursor && Number.isFinite(cursor.lastBlock)) {
    return cursor.lastBlock;
  }
  return getMeta('lastBlock');
}

function setLastBlock(n: number) {
  const nowSec = Math.floor(Date.now() / 1000);
  setIndexerCursor(CHAIN_ID, n, nowSec);
  setMeta('lastBlock', n);
  setMeta('lastUpdatedAt', Date.now());
}

async function head(): Promise<number> {
  return provider.getBlockNumber();
}

function looksRangeError(err: any): boolean {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  const code = err?.code ?? err?.error?.code;
  return (
    message.includes('more than') ||
    message.includes('block range') ||
    message.includes('result set too large') ||
    message.includes('requested too many') ||
    message.includes('free tier') ||
    code === -32600
  );
}

function isTransient(err: any): boolean {
  if (looksRangeError(err)) return true;
  const code = err?.code ?? err?.status ?? err?.error?.code;
  if (code === 'TIMEOUT' || code === -32016) return true;
  const message = String(err?.message ?? err ?? '').toLowerCase();
  return /rate limit|timeout|econnreset|etimedout|socket hang up/.test(message);
}

async function getLogsWithBackoff(params: { address: string | string[]; topics?: (string | null | string[])[]; fromBlock: number; toBlock: number }) {
  let delay = 300;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await provider.getLogs({
        address: params.address,
        topics: params.topics as any,
        fromBlock: params.fromBlock,
        toBlock: params.toBlock
      });
    } catch (err: any) {
      if (!isTransient(err)) throw err;
      await sleep(delay);
      delay = Math.min(5000, delay * 2);
    }
  }
  throw new Error(`getLogs backoff exhausted ${params.fromBlock}-${params.toBlock}`);
}

async function runBatch(fromBlock: number, toBlock: number) {
  const contractTargets = Array.from(new Set([pmAddress, vaultAddress, ...rewardSources]));
  const storedLogs: StoredLog[] = [];
  const seenKeys = new Set<string>();

  if (contractTargets.length) {
    const chunk = await getLogsWithBackoff({ address: contractTargets, fromBlock, toBlock });
    for (const raw of chunk as Log[]) {
        const address = raw.address?.toLowerCase?.() ?? '';
        const txHash = (raw.transactionHash ?? (raw as any)?.txHash ?? '').toLowerCase();
        const logIndex = Number((raw as any).index ?? (raw as any).logIndex ?? 0);
        if (!txHash) continue;
        const key = `${address}:${txHash}:${logIndex}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        storedLogs.push(serializeLog(raw));
    }
  }

  if (storedLogs.length) {
    appendStoredLogs(storedLogs);
    await ingestJsonLogs(provider);
  }

  if (rewardToken && env.rewardDistributors.length) {
    for (const distributor of rewardSources) {
      const distributorTopic = `0x${distributor.replace(/^0x/, '').padStart(64, '0')}`;
      const chunk = await getLogsWithBackoff({
        address: rewardToken,
        topics: [TRANSFER_TOPIC, distributorTopic],
        fromBlock,
        toBlock
      });
      for (const raw of chunk as Log[]) {
        await handleRewardTransferLog(provider, raw);
      }
    }
  }
  await flushProfiles();
}

async function maybeResnapshot(provider: JsonRpcProvider) {
  if (RESNAPSHOT_INTERVAL_MS <= 0 || nextResnapshotAt === Number.POSITIVE_INFINITY) {
    return;
  }
  const now = Date.now();
  if (now < nextResnapshotAt) {
    return;
  }
  try {
    await queueResnapshotForActiveMarkets();
    await flushPendingMarketStates(provider);
    await syncMarketHeuristicsSnapshots((message, extra) => {
      if (extra !== undefined) {
        console.log(message, extra);
      } else {
        console.log(message);
      }
    });
  } catch (error) {
    console.warn('nightly_resnapshot_failed', error);
  } finally {
    nextResnapshotAt = now + RESNAPSHOT_INTERVAL_MS;
  }
}

async function follow() {
  let last = getLastBlock();

  while (true) {
    try {
      const h = await head();
      const safeTip = Math.max(0, h - CONFIRMATIONS);
      if (safeTip > last) {
        let from = last + 1;
        while (from <= safeTip) {
          const to = Math.min(from + STEP - 1, safeTip);
          console.log('sync', from, '->', to, '(step', STEP, ')');
          try {
            await runBatch(from, to);
            await flushPendingMarketStates(provider);
            setLastBlock(to);
            from = to + 1;
            last = to;
            await maybeResnapshot(provider);
          } catch (error) {
            if (isTransient(error)) {
              console.warn('transient getLogs error, retrying', { from, to, error });
              await sleep(500);
              continue;
            }
            throw error;
          }
        }
      }
    } catch (err) {
      console.error('follow loop error', err);
      rpcIndex = (rpcIndex + 1) % RPCS.length;
      provider = makeProvider(rpcIndex);
    }
    await sleep(POLL_MS);
  }
}

async function start() {
  startHttpServer();
  await ensureSeedOnce({
    chainId: CHAIN_ID,
    backfillDays: BACKFILL_DAYS,
    confirmations: CONFIRMATIONS,
    provider,
    log: (...args) => console.log(...args)
  });
  scheduleMentionSync((message, extra) => {
    if (extra !== undefined) {
      console.log(message, extra);
    } else {
      console.log(message);
    }
  });
  const seededCursor = getLastBlock();
  setMeta('lastBlock', seededCursor);
  setMeta('lastUpdatedAt', Date.now());
  try {
    const row = db.prepare('SELECT COUNT(1) AS c FROM processed_logs').get() as { c?: number } | undefined;
    const already = Number(row?.c ?? 0);
    if (process.env.BOOTSTRAP_JSONL === '1' && already === 0) {
      console.log('bootstrap: ingesting existing JSON logs');
      await bootstrapFromExisting(provider);
    } else if (process.env.BOOTSTRAP_JSONL === '1') {
      console.log('bootstrap skipped: processed logs already present');
    }
  } catch (error) {
    console.warn('bootstrap_check_failed', error);
  }
  resetResnapshotSchedule();
  await follow();
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
