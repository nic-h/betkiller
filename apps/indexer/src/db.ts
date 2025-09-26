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
  marketId TEXT NOT NULL,
  txHash TEXT NOT NULL,
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
  payloadJson TEXT NOT NULL
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
`);

const tradeColumns = db.prepare('PRAGMA table_info(trades)').all() as { name: string }[];
if (!tradeColumns.some((c) => c.name === 'trader')) {
  db.exec('ALTER TABLE trades ADD COLUMN trader TEXT');
}

db.exec(`
CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_tx ON trades(txHash);
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
    `INSERT OR IGNORE INTO markets(marketId, creator, oracle, surplusRecipient, questionId, outcomeNames, metadata, txHash, createdAt)
     VALUES (@marketId, @creator, @oracle, @surplusRecipient, @questionId, @outcomeNames, @metadata, @txHash, @createdAt)`
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

export function insertTrade(row: { ts: number; marketId: string; txHash: string; trader: string; usdcIn: bigint; usdcOut: bigint }) {
  db.prepare(
    `INSERT INTO trades(ts, marketId, txHash, trader, usdcIn, usdcOut)
     VALUES (@ts, @marketId, @txHash, @trader, @usdcIn, @usdcOut)`
  ).run({
    ts: row.ts,
    marketId: row.marketId,
    txHash: row.txHash,
    trader: row.trader,
    usdcIn: row.usdcIn.toString(),
    usdcOut: row.usdcOut.toString()
  });
}

export function insertLockEvent(row: { ts: number; marketId: string; user: string; type: string; payload: unknown }) {
  db.prepare(
    `INSERT INTO locks(ts, marketId, user, type, payloadJson)
     VALUES (@ts, @marketId, @user, @type, @payloadJson)`
  ).run({
    ts: row.ts,
    marketId: row.marketId,
    user: row.user,
    type: row.type,
    payloadJson: JSON.stringify(row.payload)
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
