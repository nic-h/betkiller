import fs from 'node:fs';
import path from 'node:path';
import type { Log } from 'ethers';

export type StoredLog = {
  blockNumber: string;
  blockHash?: string | null;
  transactionIndex?: string | null;
  logIndex: string;
  txHash: string;
  address: string;
  data: string;
  topics: string[];
  removed?: boolean;
};

const LOG_FILE = path.resolve(process.env.LOGS_FILE ?? 'data/context_logs.jsonl');

function normalizeNumeric(value: bigint | number | string | undefined | null): string {
  if (value === undefined || value === null) return '0';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return Math.trunc(value).toString();
  if (typeof value === 'string') return value;
  return '0';
}

export function serializeLog(log: Log): StoredLog {
  const blockNumber = normalizeNumeric(log.blockNumber ?? (log as any).number ?? 0);
  const transactionIndex = (log.transactionIndex ?? (log as any).transactionIndex) as number | undefined;
  const logIndex = (log.index ?? (log as any).logIndex ?? 0) as number;

  return {
    blockNumber,
    blockHash: (log.blockHash ?? (log as any).blockHash ?? null) as string | null,
    transactionIndex: transactionIndex != null ? transactionIndex.toString() : null,
    logIndex: logIndex.toString(),
    txHash: (log.transactionHash ?? (log as any).transactionHash ?? (log as any).txHash ?? '').toLowerCase(),
    address: (log.address ?? '').toLowerCase(),
    data: log.data ?? '0x',
    topics: Array.from(log.topics ?? []),
    removed: Boolean((log as any).removed ?? false)
  };
}

export function appendStoredLogs(logs: StoredLog[]): void {
  if (!logs.length) return;
  const lines = logs.map((entry) => JSON.stringify(entry));
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, `${lines.join('\n')}\n`, 'utf8');
}

export function getLogsFilePath(): string {
  return LOG_FILE;
}
