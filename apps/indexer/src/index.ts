import 'dotenv/config';
import { JsonRpcProvider, Log } from 'ethers';
import { env } from './env.js';
import { db } from './db.js';
import {
  handleMarketLog,
  handleVaultLog,
  handleRewardTransferLog,
  flushPendingMarketStates,
  flushProfiles,
  TRANSFER_TOPIC
} from './handlers.js';

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

const FINALITY_LAG = Number(process.env.FINALITY_LAG_BLOCKS ?? 12);
let STEP = Number(process.env.LOG_STEP ?? 1500);
const POLL_MS = Number(process.env.POLL_MS ?? 4000);

const pmAddress = env.predictionMarket.toLowerCase();
const vaultAddress = env.vault.toLowerCase();
const rewardToken = env.rewardToken?.toLowerCase();
const rewardSources = env.rewardDistributors.map((addr) => addr.toLowerCase());

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return getMeta('lastBlock');
}

function setLastBlock(n: number) {
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

function looksRateLimit(err: any): boolean {
  const message = String(err?.message ?? err ?? '').toLowerCase();
  const code = err?.code ?? err?.status ?? err?.error?.code;
  return message.includes('429') || message.includes('rate') || message.includes('limit') || code === 429;
}

async function* getLogsSafe(params: {
  address: string | string[];
  topics?: (string | null | string[])[];
  fromBlock: number;
  toBlock: number;
}) {
  let from = params.fromBlock;
  const toBlock = params.toBlock;

  while (from <= toBlock) {
    const to = Math.min(from + STEP - 1, toBlock);
    try {
      const logs = await provider.getLogs({
        address: params.address,
        topics: params.topics as any,
        fromBlock: from,
        toBlock: to
      });
      yield logs;
      from = to + 1;
      STEP = Math.min(STEP * 2, Number(process.env.LOG_STEP ?? 1500));
    } catch (err: any) {
      if (looksRangeError(err) || looksRateLimit(err)) {
        STEP = Math.max(200, Math.floor(STEP / 2));
        await sleep(300);
        continue;
      }
      console.warn('provider error, rotating', err?.message ?? err);
      rpcIndex = (rpcIndex + 1) % RPCS.length;
      provider = makeProvider(rpcIndex);
      await sleep(500);
    }
  }
}

async function runBatch(fromBlock: number, toBlock: number) {
  const targetAddresses = [pmAddress, vaultAddress];

  for await (const chunk of getLogsSafe({ address: targetAddresses, fromBlock, toBlock })) {
    for (const raw of chunk as Log[]) {
      const address = raw.address.toLowerCase();
      if (address === pmAddress) {
        await handleMarketLog(provider, raw);
      } else if (address === vaultAddress) {
        await handleVaultLog(provider, raw);
      }
    }
  }

  if (rewardToken && rewardSources.length) {
    for (const distributor of rewardSources) {
      const distributorTopic = `0x${distributor.replace(/^0x/, '').padStart(64, '0')}`;
      for await (const chunk of getLogsSafe({
        address: rewardToken,
        topics: [TRANSFER_TOPIC, distributorTopic],
        fromBlock,
        toBlock
      })) {
        for (const raw of chunk as Log[]) {
          await handleRewardTransferLog(provider, raw);
        }
      }
    }
  }

  await flushPendingMarketStates(provider);
  await flushProfiles();
}

async function follow() {
  let last = getLastBlock();
  if (!last) {
    const h = await head();
    last = Math.max(0, h - FINALITY_LAG);
    setLastBlock(last);
  }

  while (true) {
    try {
      const h = await head();
      const safeTip = Math.max(0, h - FINALITY_LAG);
      if (safeTip > last) {
        let from = last + 1;
        while (from <= safeTip) {
          const to = Math.min(from + STEP - 1, safeTip);
          console.log('sync', from, '->', to, '(step', STEP, ')');
          await runBatch(from, to);
          setLastBlock(to);
          from = to + 1;
          last = to;
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

follow().catch((err) => {
  console.error(err);
  process.exit(1);
});
