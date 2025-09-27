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

CREATE TABLE IF NOT EXISTS reward_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txHash TEXT NOT NULL,
  logIndex INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  user TEXT NOT NULL,
  amount TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS idx_locks_ts ON locks(ts);
CREATE INDEX IF NOT EXISTS idx_locks_user_ts ON locks(user, ts);
CREATE INDEX IF NOT EXISTS idx_rewards_ts ON rewards(ts);
CREATE INDEX IF NOT EXISTS idx_rewards_user_ts ON rewards(user, ts);
CREATE INDEX IF NOT EXISTS idx_trades_market_ts ON trades(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_trades_trader_ts ON trades(trader, ts);
CREATE INDEX IF NOT EXISTS idx_markets_createdAt ON markets(createdAt);
CREATE INDEX IF NOT EXISTS idx_market_state_market_ts ON market_state(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_resolutions_ts ON resolutions(ts);
CREATE INDEX IF NOT EXISTS idx_redemptions_user_ts ON redemptions(user, ts);
CREATE INDEX IF NOT EXISTS idx_redemptions_market_ts ON redemptions(marketId, ts);
CREATE INDEX IF NOT EXISTS idx_reward_claims_user_ts ON reward_claims(user, ts);
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

const insertRewardClaimStmt = db.prepare(
  `INSERT OR IGNORE INTO reward_claims(txHash, logIndex, ts, user, amount)
   VALUES (@txHash, @logIndex, @ts, @user, @amount)`
);

export function insertRewardClaim(row: {
  txHash: string;
  logIndex: number;
  ts: number;
  user: string;
  amount: bigint;
}) {
  insertRewardClaimStmt.run({
    txHash: row.txHash,
    logIndex: row.logIndex,
    ts: row.ts,
    user: row.user,
    amount: row.amount.toString()
  });
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
