import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { env } from "./env.js";

const dbPath = path.isAbsolute(env.databasePath)
  ? env.databasePath
  : path.resolve(process.cwd(), env.databasePath);

const parentDir = path.dirname(dbPath);
if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true });
}

export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -200000");
db.pragma("temp_store = MEMORY");

db.exec(`
CREATE TABLE IF NOT EXISTS indexer_cursor (
  chain_id INTEGER PRIMARY KEY,
  last_block INTEGER NOT NULL,
  last_ts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_meta (
  chain_id INTEGER PRIMARY KEY,
  seed_from_block INTEGER,
  seed_from_ts INTEGER,
  seed_window_days INTEGER,
  seed_completed INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS markets (
  marketId TEXT PRIMARY KEY,
  creator TEXT,
  oracle TEXT,
  surplusRecipient TEXT,
  questionId TEXT,
  outcomeNames TEXT,
  metadata TEXT,
  txHash TEXT,
  createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  marketId TEXT NOT NULL,
  pricesJson TEXT NOT NULL,
  FOREIGN KEY (marketId) REFERENCES markets(marketId)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  blockNumber TEXT,
  marketId TEXT NOT NULL,
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL DEFAULT 0,
  usdcIn TEXT NOT NULL,
  usdcOut TEXT NOT NULL,
  FOREIGN KEY (marketId) REFERENCES markets(marketId)
);

CREATE TABLE IF NOT EXISTS impact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketId TEXT NOT NULL,
  usdcClip TEXT NOT NULL,
  deltaProb REAL NOT NULL,
  ts INTEGER NOT NULL,
  FOREIGN KEY (marketId) REFERENCES markets(marketId)
);

CREATE TABLE IF NOT EXISTS market_mentions (
  marketId TEXT NOT NULL,
  source TEXT NOT NULL,
  window TEXT,
  mentions INTEGER NOT NULL,
  authors INTEGER,
  velocity REAL,
  capturedAt INTEGER NOT NULL,
  metadata TEXT,
  PRIMARY KEY (marketId, source, capturedAt)
);

CREATE TABLE IF NOT EXISTS locks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  marketId TEXT NOT NULL,
  user TEXT NOT NULL,
  type TEXT NOT NULL,
  payloadJson TEXT NOT NULL,
  txHash TEXT,
  logIndex INTEGER,
  locker TEXT,
  amounts TEXT,
  kind TEXT,
  blockNumber INTEGER
);

CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  epochId TEXT,
  user TEXT,
  amount TEXT,
  root TEXT
);

DROP TABLE IF EXISTS reward_claims;

CREATE TABLE IF NOT EXISTS reward_epochs (
  epoch_id INTEGER PRIMARY KEY,
  root TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_time INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_claims (
  epoch_id INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  block_time INTEGER NOT NULL,
  PRIMARY KEY (epoch_id, wallet)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  address TEXT PRIMARY KEY,
  display_name TEXT,
  x_handle TEXT,
  last_seen INTEGER
);

CREATE TABLE IF NOT EXISTS market_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  marketId TEXT NOT NULL,
  ts INTEGER NOT NULL,
  totalUsdc TEXT NOT NULL,
  totalQ TEXT NOT NULL,
  alpha TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS market_heuristics (
  marketId TEXT NOT NULL,
  capturedAt INTEGER NOT NULL,
  clarity REAL,
  ambiguousTerms TEXT,
  vagueCount INTEGER,
  sourceCount INTEGER,
  sourceDomains INTEGER,
  parity REAL,
  settlementScore REAL,
  warnings TEXT,
  metadata TEXT,
  PRIMARY KEY(marketId, capturedAt)
);

CREATE TABLE IF NOT EXISTS processed_logs (
  contract TEXT NOT NULL,
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL,
  blockNumber TEXT NOT NULL,
  PRIMARY KEY (contract, txHash, logIndex)
);

CREATE TABLE IF NOT EXISTS resolutions (
  marketId TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  surplus TEXT,
  payoutJson TEXT
);

CREATE TABLE IF NOT EXISTS redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  marketId TEXT NOT NULL,
  user TEXT NOT NULL,
  token TEXT NOT NULL,
  shares TEXT NOT NULL,
  payout TEXT NOT NULL,
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL,
  UNIQUE (txHash, logIndex)
);

CREATE TABLE IF NOT EXISTS stakes (
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL,
  marketId TEXT NOT NULL,
  staker TEXT NOT NULL,
  amounts TEXT NOT NULL,
  blockNumber INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY(txHash, logIndex)
);

CREATE TABLE IF NOT EXISTS sponsored_locks (
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL,
  marketId TEXT NOT NULL,
  user TEXT NOT NULL,
  setsAmount TEXT,
  userPaid TEXT,
  subsidyUsed TEXT,
  actualCost TEXT,
  outcomes INTEGER,
  nonce TEXT,
  blockNumber INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY(txHash, logIndex)
);

CREATE TABLE IF NOT EXISTS surplus_withdrawals (
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL,
  toAddr TEXT NOT NULL,
  amount TEXT NOT NULL,
  blockNumber INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY(txHash, logIndex)
);
`);

const selectCursorStmt = db.prepare(
  'SELECT last_block as lastBlock, last_ts as lastTs FROM indexer_cursor WHERE chain_id = ?'
);

const upsertCursorStmt = db.prepare(`
INSERT INTO indexer_cursor(chain_id, last_block, last_ts)
VALUES (@chainId, @lastBlock, @lastTs)
ON CONFLICT(chain_id) DO UPDATE SET
  last_block = excluded.last_block,
  last_ts = excluded.last_ts
`);

const selectSeedMetaStmt = db.prepare(
  `SELECT seed_from_block as seedFromBlock,
          seed_from_ts as seedFromTs,
          seed_window_days as seedWindowDays,
          seed_completed as seedCompleted,
          created_at as createdAt,
          updated_at as updatedAt
   FROM indexer_meta WHERE chain_id = ?`
);

const upsertSeedMetaStmt = db.prepare(`
INSERT INTO indexer_meta(chain_id, seed_from_block, seed_from_ts, seed_window_days, seed_completed, created_at, updated_at)
VALUES (@chainId, @seedFromBlock, @seedFromTs, @seedWindowDays, @seedCompleted, @createdAt, @updatedAt)
ON CONFLICT(chain_id) DO UPDATE SET
  seed_from_block = excluded.seed_from_block,
  seed_from_ts = excluded.seed_from_ts,
  seed_window_days = excluded.seed_window_days,
  seed_completed = excluded.seed_completed,
  updated_at = excluded.updated_at
`);

export function getIndexerCursor(chainId: number): { lastBlock: number; lastTs: number } | undefined {
  const row = selectCursorStmt.get(chainId) as { lastBlock?: number; lastTs?: number } | undefined;
  if (!row || row.lastBlock == null || row.lastTs == null) return undefined;
  return { lastBlock: Number(row.lastBlock), lastTs: Number(row.lastTs) };
}

export function setIndexerCursor(chainId: number, lastBlock: number, lastTs: number) {
  upsertCursorStmt.run({ chainId, lastBlock: Math.trunc(lastBlock), lastTs: Math.trunc(lastTs) });
}

export type SeedMetaRow = {
  seedFromBlock: number | null;
  seedFromTs: number | null;
  seedWindowDays: number | null;
  seedCompleted: number | null;
  createdAt: number | null;
  updatedAt: number | null;
};

export function getSeedMeta(chainId: number): SeedMetaRow | undefined {
  const row = selectSeedMetaStmt.get(chainId) as SeedMetaRow | undefined;
  if (!row) return undefined;
  return {
    seedFromBlock: row.seedFromBlock != null ? Number(row.seedFromBlock) : null,
    seedFromTs: row.seedFromTs != null ? Number(row.seedFromTs) : null,
    seedWindowDays: row.seedWindowDays != null ? Number(row.seedWindowDays) : null,
    seedCompleted: row.seedCompleted != null ? Number(row.seedCompleted) : null,
    createdAt: row.createdAt != null ? Number(row.createdAt) : null,
    updatedAt: row.updatedAt != null ? Number(row.updatedAt) : null
  };
}

export function upsertSeedMeta(row: {
  chainId: number;
  seedFromBlock: number | null;
  seedFromTs: number | null;
  seedWindowDays: number | null;
  seedCompleted: number;
  createdAt: number;
  updatedAt: number;
}) {
  upsertSeedMetaStmt.run({
    chainId: row.chainId,
    seedFromBlock: row.seedFromBlock,
    seedFromTs: row.seedFromTs,
    seedWindowDays: row.seedWindowDays,
    seedCompleted: row.seedCompleted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

const tradeColumns = db.prepare('PRAGMA table_info(trades)').all() as { name: string }[];
if (!tradeColumns.some((c) => c.name === 'trader')) {
  db.exec('ALTER TABLE trades ADD COLUMN trader TEXT');
}
if (!tradeColumns.some((c) => c.name === 'logIndex')) {
  db.exec('ALTER TABLE trades ADD COLUMN logIndex INTEGER DEFAULT 0');
}
if (!tradeColumns.some((c) => c.name === 'blockNumber')) {
  db.exec('ALTER TABLE trades ADD COLUMN blockNumber TEXT');
}

const lockColumns = db.prepare('PRAGMA table_info(locks)').all() as { name: string }[];
if (!lockColumns.some((c) => c.name === 'txHash')) {
  db.exec('ALTER TABLE locks ADD COLUMN txHash TEXT');
}
if (!lockColumns.some((c) => c.name === 'logIndex')) {
  db.exec('ALTER TABLE locks ADD COLUMN logIndex INTEGER');
}
if (!lockColumns.some((c) => c.name === 'locker')) {
  db.exec('ALTER TABLE locks ADD COLUMN locker TEXT');
}
if (!lockColumns.some((c) => c.name === 'amounts')) {
  db.exec('ALTER TABLE locks ADD COLUMN amounts TEXT');
}
if (!lockColumns.some((c) => c.name === 'kind')) {
  db.exec('ALTER TABLE locks ADD COLUMN kind TEXT');
}
if (!lockColumns.some((c) => c.name === 'blockNumber')) {
  db.exec('ALTER TABLE locks ADD COLUMN blockNumber INTEGER');
}

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_txlog ON trades(txHash, logIndex);
CREATE INDEX IF NOT EXISTS idx_prices_market_ts ON prices(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_impact_market ON impact(marketId);
CREATE INDEX IF NOT EXISTS idx_market_mentions_captured ON market_mentions(capturedAt DESC);
CREATE INDEX IF NOT EXISTS idx_market_mentions_market ON market_mentions(marketId, capturedAt DESC);
CREATE INDEX IF NOT EXISTS idx_locks_ts ON locks(ts);
CREATE INDEX IF NOT EXISTS idx_locks_user_ts ON locks(user, ts);
CREATE INDEX IF NOT EXISTS idx_rewards_ts ON rewards(ts);
CREATE INDEX IF NOT EXISTS idx_rewards_user_ts ON rewards(user, ts);
CREATE INDEX IF NOT EXISTS idx_trades_market_ts ON trades(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_trades_trader_ts ON trades(trader, ts);
CREATE INDEX IF NOT EXISTS idx_markets_createdAt ON markets(createdAt);
CREATE INDEX IF NOT EXISTS idx_market_state_market_ts ON market_state(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_market_heuristics_market ON market_heuristics(marketId, capturedAt DESC);
CREATE INDEX IF NOT EXISTS idx_market_heuristics_captured ON market_heuristics(capturedAt DESC);
CREATE INDEX IF NOT EXISTS idx_resolutions_ts ON resolutions(ts);
CREATE INDEX IF NOT EXISTS idx_redemptions_user_ts ON redemptions(user, ts);
CREATE INDEX IF NOT EXISTS idx_redemptions_market_ts ON redemptions(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_reward_epochs_block_time ON reward_epochs(block_time);
CREATE INDEX IF NOT EXISTS idx_reward_claims_wallet_time ON reward_claims(wallet, block_time);
CREATE INDEX IF NOT EXISTS idx_reward_claims_epoch ON reward_claims(epoch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locks_txlog ON locks(txHash, logIndex);
CREATE INDEX IF NOT EXISTS idx_stakes_market_ts ON stakes(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_sponsored_locks_market_ts ON sponsored_locks(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_surplus_withdrawals_ts ON surplus_withdrawals(ts);
`);

const activeMarketsStmt = db.prepare(
  `SELECT m.marketId
   FROM markets m
   LEFT JOIN resolutions r ON r.marketId = m.marketId
   WHERE r.marketId IS NULL`
);

const allMarketMetadataStmt = db.prepare(
  `SELECT marketId, metadata
   FROM markets`
);

type ProcessedLogKey = {
  contract: string;
  txHash: string;
  logIndex: number;
};

type ProcessedLogInsert = ProcessedLogKey & { blockNumber: bigint | number };

const processedLogExistsStmt = db.prepare(
  `SELECT 1 FROM processed_logs WHERE contract = ? AND txHash = ? AND logIndex = ?`
);

const insertProcessedLogStmt = db.prepare(`
INSERT OR IGNORE INTO processed_logs(contract, txHash, logIndex, blockNumber)
VALUES (@contract, @txHash, @logIndex, @blockNumber)
`);

type MetaKey = "last_block_synced";

export function getLastProcessedBlock(key: MetaKey): bigint | undefined {
  const row = db.prepare(`SELECT value FROM meta WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return undefined;
  return BigInt(row.value);
}

export function setLastProcessedBlock(key: MetaKey, value: bigint) {
  db.prepare(`INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    value.toString()
  );
}

export function hasProcessedLog(identity: ProcessedLogKey): boolean {
  return Boolean(processedLogExistsStmt.get(identity.contract, identity.txHash, identity.logIndex));
}

export function recordProcessedLog(identity: ProcessedLogInsert) {
  insertProcessedLogStmt.run({
    contract: identity.contract,
    txHash: identity.txHash,
    logIndex: identity.logIndex,
    blockNumber:
      typeof identity.blockNumber === 'bigint' ? identity.blockNumber.toString() : String(identity.blockNumber)
  });
}

export function getActiveMarketIds(): string[] {
  const rows = activeMarketsStmt.all() as { marketId: string }[];
  return rows.map((row) => row.marketId);
}

export function getAllMarketMetadata(): { marketId: string; metadata: string | null }[] {
  return allMarketMetadataStmt.all() as { marketId: string; metadata: string | null }[];
}

const insertMentionStmt = db.prepare(
  `INSERT INTO market_mentions(marketId, source, window, mentions, authors, velocity, capturedAt, metadata)
   VALUES (@marketId, @source, @window, @mentions, @authors, @velocity, @capturedAt, @metadata)
   ON CONFLICT(marketId, source, capturedAt) DO UPDATE SET
     mentions = excluded.mentions,
     authors = excluded.authors,
     velocity = excluded.velocity,
     window = excluded.window,
     metadata = excluded.metadata`
);

export function upsertMarketMentions(rows: Array<{
  marketId: string;
  source: string;
  window?: string | null;
  mentions: number;
  authors?: number | null;
  velocity?: number | null;
  capturedAt: number;
  metadata?: unknown;
}>) {
  const run = db.transaction((entries: typeof rows) => {
    for (const row of entries) {
      insertMentionStmt.run({
        marketId: row.marketId,
        source: row.source,
        window: row.window ?? null,
        mentions: Math.max(0, Math.trunc(row.mentions)),
        authors: row.authors != null ? Math.max(0, Math.trunc(row.authors)) : null,
        velocity: row.velocity ?? null,
        capturedAt: Math.trunc(row.capturedAt),
        metadata: row.metadata ? JSON.stringify(row.metadata) : null
      });
    }
  });
  run(rows);
}

const insertHeuristicStmt = db.prepare(
  `INSERT INTO market_heuristics(marketId, capturedAt, clarity, ambiguousTerms, vagueCount, sourceCount, sourceDomains, parity, settlementScore, warnings, metadata)
   VALUES (@marketId, @capturedAt, @clarity, @ambiguousTerms, @vagueCount, @sourceCount, @sourceDomains, @parity, @settlementScore, @warnings, @metadata)
   ON CONFLICT(marketId, capturedAt) DO UPDATE SET
     clarity = excluded.clarity,
     ambiguousTerms = excluded.ambiguousTerms,
     vagueCount = excluded.vagueCount,
     sourceCount = excluded.sourceCount,
     sourceDomains = excluded.sourceDomains,
     parity = excluded.parity,
     settlementScore = excluded.settlementScore,
     warnings = excluded.warnings,
     metadata = excluded.metadata`
);

export function insertMarketHeuristicSnapshots(rows: Array<{
  marketId: string;
  capturedAt: number;
  clarity: number | null;
  ambiguousTerms: string[];
  vagueCount: number | null;
  sourceCount: number | null;
  sourceDomains: number | null;
  parity: number | null;
  settlementScore: number | null;
  warnings: string[];
  metadata?: unknown;
}>) {
  const run = db.transaction((entries: typeof rows) => {
    for (const row of entries) {
      insertHeuristicStmt.run({
        marketId: row.marketId,
        capturedAt: Math.trunc(row.capturedAt),
        clarity: row.clarity,
        ambiguousTerms: row.ambiguousTerms.length ? JSON.stringify(row.ambiguousTerms) : null,
        vagueCount: row.vagueCount ?? null,
        sourceCount: row.sourceCount ?? null,
        sourceDomains: row.sourceDomains ?? null,
        parity: row.parity ?? null,
        settlementScore: row.settlementScore ?? null,
        warnings: row.warnings.length ? JSON.stringify(row.warnings) : null,
        metadata: row.metadata ? JSON.stringify(row.metadata) : null
      });
    }
  });
  run(rows);
}

export type MarketInsert = {
  marketId: `0x${string}`;
  creator: `0x${string}`;
  oracle: `0x${string}`;
  surplusRecipient: `0x${string}`;
  questionId: `0x${string}`;
  outcomeNames: string[];
  metadata: `0x${string}` | null;
  txHash: `0x${string}`;
  createdAt: number;
};

export function insertMarket(row: MarketInsert) {
  db.prepare(
    `INSERT INTO markets(marketId, creator, oracle, surplusRecipient, questionId, outcomeNames, metadata, txHash, createdAt)
     VALUES (@marketId, @creator, @oracle, @surplusRecipient, @questionId, @outcomeNames, @metadata, @txHash, @createdAt)
     ON CONFLICT(marketId) DO UPDATE SET
       creator = excluded.creator,
       oracle = excluded.oracle,
       surplusRecipient = excluded.surplusRecipient,
       questionId = excluded.questionId,
       outcomeNames = excluded.outcomeNames,
       metadata = excluded.metadata,
       txHash = excluded.txHash,
       createdAt = excluded.createdAt`
  ).run({
    ...row,
    outcomeNames: JSON.stringify(row.outcomeNames),
    metadata: row.metadata ?? null
  });
}

export function upsertImpact(row: { marketId: string; usdcClip: bigint; deltaProb: number; ts: number }) {
  db.prepare(
    `INSERT INTO impact(marketId, usdcClip, deltaProb, ts)
     VALUES (@marketId, @usdcClip, @deltaProb, @ts)`
  ).run({
    ...row,
    usdcClip: row.usdcClip.toString()
  });
}

export function insertPrice(row: { ts: number; marketId: string; prices: bigint[] }) {
  db.prepare(
    `INSERT INTO prices(ts, marketId, pricesJson)
     VALUES (@ts, @marketId, @pricesJson)`
  ).run({
    ts: row.ts,
    marketId: row.marketId,
    pricesJson: JSON.stringify(row.prices.map((p) => p.toString()))
  });
}

const insertTradeStmt = db.prepare(
  `INSERT OR IGNORE INTO trades(ts, blockNumber, marketId, txHash, logIndex, trader, usdcIn, usdcOut)
   VALUES (@ts, @blockNumber, @marketId, @txHash, @logIndex, @trader, @usdcIn, @usdcOut)`
);

const insertLockStmt = db.prepare(
  `INSERT OR IGNORE INTO locks(txHash, logIndex, marketId, locker, amounts, kind, blockNumber, ts, user, type, payloadJson)
   VALUES (@txHash, @logIndex, @marketId, @locker, @amounts, @kind, @blockNumber, @ts, @user, @type, @payloadJson)`
);

const insertStakeStmt = db.prepare(
  `INSERT OR IGNORE INTO stakes(txHash, logIndex, marketId, staker, amounts, blockNumber, ts)
   VALUES (@txHash, @logIndex, @marketId, @staker, @amounts, @blockNumber, @ts)`
);

const insertSponsoredLockStmt = db.prepare(
  `INSERT OR IGNORE INTO sponsored_locks(txHash, logIndex, marketId, user, setsAmount, userPaid, subsidyUsed, actualCost, outcomes, nonce, blockNumber, ts)
   VALUES (@txHash, @logIndex, @marketId, @user, @setsAmount, @userPaid, @subsidyUsed, @actualCost, @outcomes, @nonce, @blockNumber, @ts)`
);

const insertSurplusWithdrawalStmt = db.prepare(
  `INSERT OR IGNORE INTO surplus_withdrawals(txHash, logIndex, toAddr, amount, blockNumber, ts)
   VALUES (@txHash, @logIndex, @toAddr, @amount, @blockNumber, @ts)`
);

export function insertTrade(row: {
  ts: number;
  blockNumber: number;
  marketId: string;
  txHash: string;
  logIndex: number;
  trader: string;
  usdcIn: bigint;
  usdcOut: bigint;
}) {
  insertTradeStmt.run({
    ts: row.ts,
    blockNumber: row.blockNumber.toString(),
    marketId: row.marketId,
    txHash: row.txHash,
    logIndex: row.logIndex,
    trader: row.trader,
    usdcIn: row.usdcIn.toString(),
    usdcOut: row.usdcOut.toString()
  });
}

export function insertLockEvent(row: {
  txHash: string;
  logIndex: number;
  marketId: string;
  locker: string;
  kind: string;
  amounts: string[];
  blockNumber: number;
  ts: number;
  payload?: unknown;
}) {
  insertLockStmt.run({
    txHash: row.txHash,
    logIndex: row.logIndex,
    marketId: row.marketId,
    locker: row.locker,
    amounts: JSON.stringify(row.amounts),
    kind: row.kind,
    blockNumber: row.blockNumber,
    ts: row.ts,
    user: row.locker,
    type: row.kind,
    payloadJson: JSON.stringify(row.payload ?? { amounts: row.amounts })
  });
}

export function insertStakeEvent(row: {
  txHash: string;
  logIndex: number;
  marketId: string;
  staker: string;
  amounts: string[];
  blockNumber: number;
  ts: number;
}) {
  insertStakeStmt.run({
    txHash: row.txHash,
    logIndex: row.logIndex,
    marketId: row.marketId,
    staker: row.staker,
    amounts: JSON.stringify(row.amounts),
    blockNumber: row.blockNumber,
    ts: row.ts
  });
}

export function insertSponsoredLock(row: {
  txHash: string;
  logIndex: number;
  marketId: string;
  user: string;
  setsAmount: string | null;
  userPaid: string | null;
  subsidyUsed: string | null;
  actualCost: string | null;
  outcomes: number | null;
  nonce: string | null;
  blockNumber: number;
  ts: number;
}) {
  insertSponsoredLockStmt.run({
    txHash: row.txHash,
    logIndex: row.logIndex,
    marketId: row.marketId,
    user: row.user,
    setsAmount: row.setsAmount,
    userPaid: row.userPaid,
    subsidyUsed: row.subsidyUsed,
    actualCost: row.actualCost,
    outcomes: row.outcomes,
    nonce: row.nonce,
    blockNumber: row.blockNumber,
    ts: row.ts
  });
}

export function insertSurplusWithdrawal(row: {
  txHash: string;
  logIndex: number;
  toAddr: string;
  amount: string;
  blockNumber: number;
  ts: number;
}) {
  insertSurplusWithdrawalStmt.run({
    txHash: row.txHash,
    logIndex: row.logIndex,
    toAddr: row.toAddr,
    amount: row.amount,
    blockNumber: row.blockNumber,
    ts: row.ts
  });
}

export function insertRewardEvent(row: {
  ts: number;
  kind: "root" | "claim";
  epochId: string;
  user?: string | null;
  amount?: bigint | null;
  root?: string | null;
}) {
  db.prepare(
    `INSERT INTO rewards(ts, kind, epochId, user, amount, root)
     VALUES (@ts, @kind, @epochId, @user, @amount, @root)`
  ).run({
    ts: row.ts,
    kind: row.kind,
    epochId: row.epochId,
    user: row.user ?? null,
    amount: row.amount ? row.amount.toString() : null,
    root: row.root ?? null
  });
}

export function insertResolution(row: { marketId: string; ts: number; surplus: bigint; payout: bigint[] }) {
  db.prepare(
    `INSERT INTO resolutions(marketId, ts, surplus, payoutJson)
     VALUES (@marketId, @ts, @surplus, @payoutJson)
     ON CONFLICT(marketId) DO UPDATE SET ts = excluded.ts, surplus = excluded.surplus, payoutJson = excluded.payoutJson`
  ).run({
    marketId: row.marketId,
    ts: row.ts,
    surplus: row.surplus.toString(),
    payoutJson: JSON.stringify(row.payout.map((value) => value.toString()))
  });
}

export function insertRedemption(row: {
  ts: number;
  marketId: string;
  user: string;
  token: string;
  shares: bigint;
  payout: bigint;
  txHash: string;
  logIndex: number;
}) {
  db.prepare(
    `INSERT OR IGNORE INTO redemptions(ts, marketId, user, token, shares, payout, txHash, logIndex)
     VALUES (@ts, @marketId, @user, @token, @shares, @payout, @txHash, @logIndex)`
  ).run({
    ts: row.ts,
    marketId: row.marketId,
    user: row.user,
    token: row.token,
    shares: row.shares.toString(),
    payout: row.payout.toString(),
    txHash: row.txHash,
    logIndex: row.logIndex
  });
}

const selectMetaValueStmt = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMetaValueStmt = db.prepare(
  `INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
);

function setMetaNumber(key: string, value: number) {
  setMetaValueStmt.run(key, String(value));
}

function getMetaNumber(key: string): number {
  const row = selectMetaValueStmt.get(key) as { value?: string } | undefined;
  if (!row?.value) return 0;
  const parsed = Number(row.value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getMetaNumberValue(key: string): number {
  return getMetaNumber(key);
}

export function setMetaNumberValue(key: string, value: number) {
  setMetaNumber(key, value);
}

const upsertRewardEpochStmt = db.prepare(
  `INSERT INTO reward_epochs(epoch_id, root, tx_hash, block_time)
   VALUES (@epochId, @root, @txHash, @blockTime)
   ON CONFLICT(epoch_id) DO UPDATE SET
     root = excluded.root,
     tx_hash = excluded.tx_hash,
     block_time = excluded.block_time`
);

export function upsertRewardEpoch(row: { epochId: number; root: string; txHash: string; blockTime: number }) {
  upsertRewardEpochStmt.run({
    epochId: row.epochId,
    root: row.root,
    txHash: row.txHash,
    blockTime: row.blockTime
  });
}

function toMicroString(amount: bigint): string {
  return amount.toString();
}

const upsertRewardClaimStmt = db.prepare(
  `INSERT INTO reward_claims(epoch_id, wallet, amount_usdc, tx_hash, block_time)
   VALUES (@epochId, @wallet, @amount, @txHash, @blockTime)
   ON CONFLICT(epoch_id, wallet) DO UPDATE SET
     amount_usdc = excluded.amount_usdc,
     tx_hash = excluded.tx_hash,
     block_time = excluded.block_time`
);

export function upsertRewardClaim(row: {
  epochId: number;
  wallet: string;
  amount: bigint;
  txHash: string;
  blockTime: number;
}) {
  upsertRewardClaimStmt.run({
    epochId: row.epochId,
    wallet: row.wallet,
    amount: toMicroString(row.amount),
    txHash: row.txHash,
    blockTime: row.blockTime
  });
}

const hasRewardClaimForTxStmt = db.prepare('SELECT 1 FROM reward_claims WHERE tx_hash = ? LIMIT 1');

export function hasRewardClaimForTx(txHash: string): boolean {
  const row = hasRewardClaimForTxStmt.get(txHash) as { 1?: number } | undefined;
  return !!row;
}

const selectRewardClaimByTxStmt = db.prepare(
  `SELECT epoch_id as epochId, amount_usdc as amount
   FROM reward_claims
   WHERE tx_hash = ?`
);

export function getRewardClaimForTx(txHash: string): { epochId: number; amount: bigint } | null {
  const row = selectRewardClaimByTxStmt.get(txHash) as { epochId?: number; amount?: string } | undefined;
  if (!row?.epochId) return null;
  return {
    epochId: Number(row.epochId),
    amount: BigInt(row.amount ?? '0')
  };
}

const selectRewardEpochsStmt = db.prepare(
  `SELECT epoch_id as epochId, root, tx_hash as txHash, block_time as blockTime
   FROM reward_epochs
   ORDER BY epoch_id DESC`
);

const selectRewardClaimStmt = db.prepare(
  `SELECT amount_usdc as amount, tx_hash as txHash, block_time as blockTime
   FROM reward_claims
   WHERE epoch_id = ? AND wallet = ?`
);

const selectRewardTotalsStmt = db.prepare(
  `SELECT COALESCE(SUM(CAST(amount_usdc AS INTEGER)), 0) AS total
   FROM reward_claims
   WHERE wallet = ?`
);

function microsToDecimalString(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined) return "0";
  let big: bigint;
  try {
    big = BigInt(value);
  } catch (error) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    big = BigInt(Math.round(num));
  }
  const negative = big < 0n;
  const abs = negative ? -big : big;
  const whole = abs / 1_000_000n;
  const fraction = abs % 1_000_000n;
  const fractionStr = fraction.toString().padStart(6, '0').replace(/0+$/, '');
  const base = fractionStr.length > 0 ? `${whole}.${fractionStr}` : whole.toString();
  return negative ? `-${base}` : base;
}

export function setRewardsSyncMeta(blockNumber: number, blockTime: number) {
  setMetaNumber('rewards_last_block', blockNumber);
  setMetaNumber('rewards_last_synced_at', blockTime);
}

export function getRewardsSyncMeta(): { lastBlock: number; lastSyncedAt: number } {
  return {
    lastBlock: getMetaNumber('rewards_last_block'),
    lastSyncedAt: getMetaNumber('rewards_last_synced_at')
  };
}

export function getIndexerHealthSnapshot(chainId: number) {
  const cursor = getIndexerCursor(chainId) ?? { lastBlock: 0, lastTs: 0 };
  const lastBlockMeta = getMetaNumber('lastBlock');
  const lastUpdatedAt = getMetaNumber('lastUpdatedAt');
  const rewardsMeta = getRewardsSyncMeta();

  return {
    chainId,
    lastBlock: cursor.lastBlock || lastBlockMeta,
    lastTs: cursor.lastTs,
    lastBlockMeta,
    lastUpdatedAt,
    rewardsLastBlock: rewardsMeta.lastBlock,
    rewardsLastSyncedAt: rewardsMeta.lastSyncedAt
  };
}

export function getRewardsForAddress(address: string) {
  const normalized = address.toLowerCase();
  const epochs = selectRewardEpochsStmt.all() as { epochId: number; root: string; txHash: string; blockTime: number }[];
  const claimTotalRow = selectRewardTotalsStmt.get(normalized) as { total?: number } | undefined;
  const claimedTotalMicro = BigInt(claimTotalRow?.total ?? 0);

  const epochSummaries = epochs.map((epoch) => {
    const claim = selectRewardClaimStmt.get(epoch.epochId, normalized) as { amount?: string; txHash?: string; blockTime?: number } | undefined;
    if (claim?.amount) {
      return {
        epochId: epoch.epochId,
        status: 'claimed' as const,
        claimed: microsToDecimalString(claim.amount),
        txHash: claim.txHash ?? null
      };
    }
    return {
      epochId: epoch.epochId,
      status: 'pending' as const
    };
  });

  const syncMeta = getRewardsSyncMeta();

  return {
    address: normalized,
    epochs: epochSummaries,
    totals: {
      claimable: '0',
      claimed: microsToDecimalString(claimedTotalMicro),
      pending: '0'
    },
    lastRootEpoch: epochs.length > 0 ? epochs[0].epochId : null,
    syncedAt: syncMeta.lastSyncedAt
  };
}

export function replaceImpactRows(marketId: string, rows: { usdcClip: bigint; deltaProb: number; ts: number }[]) {
  const deleteStmt = db.prepare('DELETE FROM impact WHERE marketId = ?');
  const insertStmt = db.prepare('INSERT INTO impact(marketId, usdcClip, deltaProb, ts) VALUES (@marketId, @usdcClip, @deltaProb, @ts)');
  const run = db.transaction(() => {
    deleteStmt.run(marketId);
    for (const row of rows) {
      insertStmt.run({
        marketId,
        usdcClip: row.usdcClip.toString(),
        deltaProb: row.deltaProb,
        ts: row.ts
      });
    }
  });
  run();
}

export const upsertProfile = db.prepare(`
INSERT INTO profiles(address, display_name, x_handle, last_seen)
VALUES(@address, @display_name, @x_handle, @last_seen)
ON CONFLICT(address) DO UPDATE SET
  display_name = excluded.display_name,
  x_handle = excluded.x_handle,
  last_seen = excluded.last_seen
`);

const selectProfileStmt = db.prepare('SELECT display_name as displayName, x_handle as xHandle, last_seen as lastSeen FROM profiles WHERE address = ?');
const touchProfileStmt = db.prepare('UPDATE profiles SET last_seen = ? WHERE address = ?');

export function getProfile(address: string): { displayName: string | null; xHandle: string | null; lastSeen: number } | undefined {
  return selectProfileStmt.get(address) as
    | {
        displayName: string | null;
        xHandle: string | null;
        lastSeen: number;
      }
    | undefined;
}

export function touchProfile(address: string, timestamp: number) {
  touchProfileStmt.run(timestamp, address);
}

const insertMarketStateStmt = db.prepare(
  `INSERT INTO market_state(marketId, ts, totalUsdc, totalQ, alpha)
   VALUES (@marketId, @ts, @totalUsdc, @totalQ, @alpha)`
);

export function insertMarketState(row: { marketId: string; ts: number; totalUsdc: bigint; totalQ: bigint; alpha: bigint }) {
  insertMarketStateStmt.run({
    marketId: row.marketId,
    ts: row.ts,
    totalUsdc: row.totalUsdc.toString(),
    totalQ: row.totalQ.toString(),
    alpha: row.alpha.toString()
  });
}

const selectMarketStmt = db.prepare('SELECT marketId FROM markets WHERE marketId = ?');

export function marketExists(marketId: string): boolean {
  return Boolean(selectMarketStmt.get(marketId));
}
