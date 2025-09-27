import fs from 'node:fs';
import path from 'node:path';
import type { Log } from 'viem';
import { client, findBlockAt } from './blockAt.js';
import { base } from 'viem/chains';

const LOG_BATCH = Math.max(Number(process.env.LOG_BATCH_SIZE ?? 4000), 3000);
const RETRIES = Number(process.env.RPC_MAX_ATTEMPTS ?? 3);
const RETRY_DELAY = Number(process.env.RPC_RETRY_DELAY_MS ?? 500);
const LOOKBACK_DAYS = Number(process.env.LOOKBACK_DAYS ?? 14);

type CtxAddrs = {
  chainId: number;
  predictionMarket: `0x${string}`;
  vault: `0x${string}`;
  rewardDistributor: `0x${string}`;
};

const addrs: CtxAddrs = JSON.parse(
  fs.readFileSync(path.resolve(process.env.ADDRESSES_FILE ?? './src/context.addresses.base.json'), 'utf8')
);
if (addrs.chainId !== base.id) {
  throw new Error(`addresses file chainId mismatch: expected ${base.id}, got ${addrs.chainId}`);
}

const OUT = path.resolve('data/context_logs.jsonl');
fs.mkdirSync(path.dirname(OUT), { recursive: true });

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (++attempt >= RETRIES) throw error;
      await sleep(RETRY_DELAY * attempt);
    }
  }
}

async function main() {
  const now = Math.floor(Date.now() / 1000);
  const fromTs = now - LOOKBACK_DAYS * 86400;
  const startBlock = await findBlockAt(fromTs);
  const latest = await client.getBlockNumber();

  const addresses = [addrs.predictionMarket, addrs.vault, addrs.rewardDistributor] as `0x${string}`[];
  let from = startBlock;
  let total = 0;

  console.log(
    JSON.stringify({
      msg: 'starting backfill',
      fromBlock: startBlock.toString(),
      toBlock: latest.toString(),
      lookbackDays: LOOKBACK_DAYS,
    }),
  );

  while (from <= latest) {
    const to = from + BigInt(LOG_BATCH) <= latest ? from + BigInt(LOG_BATCH) : latest;

    const logs = await withRetry(
      () =>
        client.getLogs({
          address: addresses,
          fromBlock: from,
          toBlock: to,
        }) as Promise<Log[]>,
    );

    if (logs.length) {
      const lines = logs
        .map(
          (log) =>
            JSON.stringify({
              blockNumber: log.blockNumber?.toString(),
              logIndex: log.logIndex?.toString(),
              txHash: log.transactionHash,
              address: log.address,
              data: log.data,
              topics: log.topics,
            }) + '\n',
        )
        .join('');
      fs.appendFileSync(OUT, lines);
    }

    total += logs.length;
    console.log(JSON.stringify({ range: `${from.toString()}-${to.toString()}`, logs: logs.length, total }));
    from = to + 1n;
  }

  console.log(JSON.stringify({ msg: 'backfill complete', total }));
  console.log(JSON.stringify({ msg: 'switch to live tail next if needed' }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
