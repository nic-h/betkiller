PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS indexer_meta(
  chain_id INTEGER PRIMARY KEY,
  seed_from_block INTEGER,
  seed_from_ts INTEGER,
  seed_window_days INTEGER,
  seed_completed INTEGER DEFAULT 0,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS indexer_cursor(
  chain_id INTEGER PRIMARY KEY,
  last_block INTEGER NOT NULL,
  last_ts INTEGER NOT NULL
);
