import fs from 'node:fs';
import { createInterface } from 'node:readline';
import type { JsonRpcProvider, Log } from 'ethers';
import { getLogsFilePath } from './logStore.js';
import {
  db,
  hasProcessedLog,
  recordProcessedLog
} from './db.js';
import {
  flushPendingMarketStates,
  flushProfiles,
  handleMarketLog,
  handleVaultLog
} from './handlers.js';
import { handleRewardDistributorLog } from './handlers/rewards.js';
import { env } from './env.js';

const LOG_FILE = getLogsFilePath();
const META_OFFSET_KEY = 'jsonl_offset';

const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMetaStmt = db.prepare(
  `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);

function loadOffset(): number {
  const row = getMetaStmt.get(META_OFFSET_KEY) as { value?: string } | undefined;
  if (!row?.value) return 0;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function saveOffset(offset: number) {
  setMetaStmt.run(META_OFFSET_KEY, Math.max(0, Math.floor(offset)).toString());
}

type RawStoredLog = {
  blockNumber?: string | number;
  blockHash?: string | null;
  transactionIndex?: string | number | null;
  logIndex?: string | number;
  txHash?: string;
  transactionHash?: string;
  address?: string;
  data?: string;
  topics?: unknown;
  removed?: boolean;
};

function normalizeTopics(topics: unknown): string[] {
  if (!topics) return [];
  if (Array.isArray(topics)) {
    return topics
      .map((topic) => (typeof topic === 'string' ? topic : null))
      .filter((topic): topic is string => topic != null);
  }
  return [];
}

function toLog(raw: RawStoredLog): Log | null {
  const address = raw.address?.toLowerCase();
  if (!address) return null;
  const blockNumber = raw.blockNumber ?? 0;
  const txHash = (raw.transactionHash ?? raw.txHash ?? '').toLowerCase();
  const logIndex = raw.logIndex ?? 0;

  const numericBlock = typeof blockNumber === 'string' ? Number(blockNumber) : Number(blockNumber);
  if (!Number.isFinite(numericBlock)) return null;

  const numericLogIndex = typeof logIndex === 'string' ? Number(logIndex) : Number(logIndex);
  if (!Number.isFinite(numericLogIndex)) return null;

  const transactionIndex = raw.transactionIndex ?? 0;
  const numericTxIndex = typeof transactionIndex === 'string' ? Number(transactionIndex) : Number(transactionIndex);

  const baseLog = {
    address,
    blockHash: raw.blockHash ?? '0x',
    blockNumber: Math.trunc(numericBlock),
    data: raw.data ?? '0x',
    index: Math.trunc(numericLogIndex),
    logIndex: Math.trunc(numericLogIndex),
    removed: Boolean(raw.removed ?? false),
    topics: normalizeTopics(raw.topics),
    transactionHash: txHash,
    transactionIndex: Math.trunc(Number.isFinite(numericTxIndex) ? numericTxIndex : 0)
  };

  return baseLog as unknown as Log;
}

const predictionMarketAddress = env.predictionMarket.toLowerCase();
const vaultAddress = env.vault.toLowerCase();
const rewardDistributorAddresses = new Set(env.rewardDistributors.map((addr) => addr.toLowerCase()));
rewardDistributorAddresses.add(env.rewardDistributor.toLowerCase());

export async function ingestJsonLogs(provider: JsonRpcProvider, opts: { force?: boolean; resetOffset?: boolean } = {}) {
  if (!fs.existsSync(LOG_FILE)) {
    return;
  }

  const stats = fs.statSync(LOG_FILE);
  const totalSize = stats.size;

  let offset = opts.resetOffset ? 0 : loadOffset();
  if (offset > totalSize) {
    offset = 0;
  }

  if (!opts.force && offset === totalSize) {
    return;
  }

  const stream = fs.createReadStream(LOG_FILE, { encoding: 'utf8', start: offset });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let processed = 0;
  const seenKeys = new Set<string>();

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: RawStoredLog;
    try {
      parsed = JSON.parse(trimmed) as RawStoredLog;
    } catch (error) {
      continue;
    }

    const log = toLog(parsed);
    if (!log) continue;
    const address = log.address.toLowerCase();
    const txHash = log.transactionHash;
    const logIndex = log.index;

    if (!txHash) continue;

    const dedupeKey = `${address}:${txHash}:${logIndex}`;
    if (seenKeys.has(dedupeKey)) {
      continue;
    }
    seenKeys.add(dedupeKey);

    const alreadyProcessed = hasProcessedLog({ contract: address, txHash, logIndex });
    if (alreadyProcessed) {
      continue;
    }

    try {
      if (address === predictionMarketAddress) {
        await handleMarketLog(provider, log);
      } else if (address === vaultAddress) {
        await handleVaultLog(provider, log);
      } else if (rewardDistributorAddresses.has(address)) {
        await handleRewardDistributorLog(provider, log);
      } else {
        continue;
      }

      recordProcessedLog({ contract: address, txHash, logIndex, blockNumber: log.blockNumber });
      processed += 1;
    } catch (error) {
      console.warn('ingest_jsonl_failed', { address, txHash, logIndex, error });
    }
  }

  const newOffset = offset + stream.bytesRead;
  saveOffset(newOffset);

  if (processed > 0) {
    await flushPendingMarketStates(provider);
    await flushProfiles();
  }
}

export async function bootstrapFromExisting(provider: JsonRpcProvider) {
  await ingestJsonLogs(provider, { force: true, resetOffset: true });
}
