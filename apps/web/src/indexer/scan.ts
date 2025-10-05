import { CONTRACT_ADDRESSES } from "@/context/addresses";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { normalizeEvent } from "@/indexer/normalize";
import { applyLogSideEffects } from "@/indexer/sideEffects";
import type { Log } from "viem";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const POLL_INTERVAL_MS = 60_000;
export const META_KEY = "indexer_last_block";

type MetaRow = {
  key: string;
  value: string;
};

export async function runIndexerLoop() {
  const client = createIndexerClient();
  const db = getDb();

  for (;;) {
    try {
      await scanOnce(client, db);
    } catch (error) {
      console.error("Indexer scan failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export type PublicClient = ReturnType<typeof createPublicClient>;

export function createIndexerClient(): PublicClient {
  return createPublicClient({
    chain: base,
    transport: http(getEnv("RPC_URL"))
  });
}

async function scanOnce(client: PublicClient, db: ReturnType<typeof getDb>) {
  const latest = await client.getBlockNumber();
  const lastProcessed = getLastProcessed(db);
  const fromBlock = lastProcessed ? BigInt(lastProcessed) + 1n : 0n;
  if (fromBlock > latest) return;

  await scanRange(client, db, fromBlock, latest);
}

export async function scanRange(
  client: PublicClient,
  db: ReturnType<typeof getDb>,
  fromBlock: bigint,
  toBlock: bigint
) {
  if (fromBlock > toBlock) return;

  const addressEntries: Array<{ key: string; address: `0x${string}` }> = [
    { key: "predictionMarket", address: CONTRACT_ADDRESSES.predictionMarket },
    { key: "vault", address: CONTRACT_ADDRESSES.vault },
    { key: "rewardDistributor", address: CONTRACT_ADDRESSES.rewardDistributor }
  ];

  const logs: Log[] = [];

  for (const entry of addressEntries) {
    const contractLogs = await client.getLogs({
      address: entry.address,
      fromBlock,
      toBlock
    });
    logs.push(...contractLogs);
    setLastProcessedForAddress(db, entry.key, Number(toBlock));
  }

  logs.sort((a, b) => {
    const blockA = a.blockNumber ?? 0n;
    const blockB = b.blockNumber ?? 0n;
    if (blockA === blockB) {
      return Number((a.logIndex ?? 0n) - (b.logIndex ?? 0n));
    }
    return blockA > blockB ? 1 : -1;
  });

  const timestampCache = new Map<string, number>();

  for (const log of logs) {
    if (log.blockNumber === undefined) continue;
    const blockKey = log.blockHash ? log.blockHash.toLowerCase() : String(log.blockNumber);
    let timestamp = timestampCache.get(blockKey);
    if (timestamp === undefined) {
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      timestamp = Number(block.timestamp ?? 0n);
      timestampCache.set(blockKey, timestamp);
    }

    const rows = normalizeEvent({ log, timestamp });
    if (rows.length > 0) {
      insertRows(db, rows);
    }
    applyLogSideEffects(db, log, timestamp);
  }

  setLastProcessed(db, Number(toBlock));
}

export function getLastProcessed(db: ReturnType<typeof getDb>): number | null {
  const row = db.prepare("SELECT value FROM indexer_meta WHERE key = ?").get(META_KEY) as MetaRow | undefined;
  if (!row) return null;
  const value = Number(row.value);
  return Number.isFinite(value) ? value : null;
}

export function setLastProcessed(db: ReturnType<typeof getDb>, block: number) {
  db.prepare("INSERT INTO indexer_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    META_KEY,
    String(block)
  );
}

export function setLastProcessedForAddress(db: ReturnType<typeof getDb>, key: string, block: number) {
  db.prepare("INSERT INTO indexer_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
    `last_block:${key}`,
    String(block)
  );
}

function insertRows(db: ReturnType<typeof getDb>, rows: ReturnType<typeof normalizeEvent>) {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO events_norm(address, user, market, kind, side, amount_fp, shares_fp, fee_fp, ts, txhash, blk, logi)
     VALUES(@address, @user, @market, @kind, @side, @amount_fp, @shares_fp, @fee_fp, @ts, @txhash, @blk, @logi)`
  );
  const insertMany = db.transaction((batch: ReturnType<typeof normalizeEvent>) => {
    for (const row of batch) {
      stmt.run({
        ...row,
        amount_fp: row.amount_fp !== null ? String(row.amount_fp) : null,
        shares_fp: row.shares_fp !== null ? String(row.shares_fp) : null,
        fee_fp: row.fee_fp !== null ? String(row.fee_fp) : null
      });
    }
  });
  insertMany(rows);
}

if (require.main === module) {
  runIndexerLoop().catch((error) => {
    console.error("Indexer terminated", error);
    process.exitCode = 1;
  });
}
