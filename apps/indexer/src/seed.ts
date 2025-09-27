import { JsonRpcProvider } from 'ethers';
import { findBlockAt } from './blockAt.js';
import {
  getIndexerCursor,
  getSeedMeta,
  setIndexerCursor,
  upsertSeedMeta,
  type SeedMetaRow
} from './db.js';

export type SeedOpts = {
  chainId: number;
  backfillDays: number;
  confirmations: number;
  provider: JsonRpcProvider;
  log?: (...args: any[]) => void;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hasCompleted(meta: SeedMetaRow | undefined): boolean {
  return Boolean(meta?.seedCompleted && meta.seedCompleted > 0);
}

export async function ensureSeedOnce(opts: SeedOpts): Promise<void> {
  const { chainId, backfillDays, confirmations, provider, log = console.log } = opts;

  const existingCursor = getIndexerCursor(chainId);
  if (existingCursor && Number.isFinite(existingCursor.lastBlock)) {
    log(`[seed] cursor exists at ${existingCursor.lastBlock}. Skip seeding.`);
    return;
  }

  const meta = getSeedMeta(chainId);
  const head = Number(await provider.getBlockNumber());
  const safeHead = Math.max(0, head - confirmations);

  if (hasCompleted(meta)) {
    const seedFromBlock = meta?.seedFromBlock != null ? Number(meta.seedFromBlock) : safeHead;
    const startBlock = Math.max(0, Math.min(seedFromBlock, safeHead) - 1);
    const ts = nowSeconds();
    setIndexerCursor(chainId, startBlock, ts);
    upsertSeedMeta({
      chainId,
      seedFromBlock,
      seedFromTs: meta?.seedFromTs ?? null,
      seedWindowDays: meta?.seedWindowDays ?? backfillDays,
      seedCompleted: 1,
      createdAt: meta?.createdAt ?? ts,
      updatedAt: ts
    });
    log(`[seed] restored cursor from meta at ${startBlock}`);
    return;
  }

  if (safeHead <= 0) {
    const ts = nowSeconds();
    setIndexerCursor(chainId, 0, ts);
    upsertSeedMeta({
      chainId,
      seedFromBlock: 0,
      seedFromTs: ts,
      seedWindowDays: backfillDays,
      seedCompleted: 1,
      createdAt: ts,
      updatedAt: ts
    });
    log('[seed] safe head not available yet; initialized cursor at 0');
    return;
  }

  const lookbackSeconds = Math.max(0, Math.floor(backfillDays * 86400));
  const seedFromTs = Math.max(0, nowSeconds() - lookbackSeconds);

  let seedFromBlock = safeHead;
  try {
    const blockAtTs = await findBlockAt(seedFromTs);
    seedFromBlock = Math.min(Number(blockAtTs), safeHead);
  } catch (error) {
    log('[seed] findBlockAt failed, defaulting to safe head', error);
  }

  const startBlock = Math.max(0, seedFromBlock - 1);
  const ts = nowSeconds();

  upsertSeedMeta({
    chainId,
    seedFromBlock,
    seedFromTs,
    seedWindowDays: backfillDays,
    seedCompleted: 1,
    createdAt: meta?.createdAt ?? ts,
    updatedAt: ts
  });

  setIndexerCursor(chainId, startBlock, ts);
  log(`[seed] set cursor to ${startBlock} (seed_from_block=${seedFromBlock}, safeHead=${safeHead})`);
}
