PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS events_norm(
  address TEXT,
  user TEXT,
  market TEXT,
  kind TEXT,
  side TEXT,
  amount_fp INTEGER,
  shares_fp INTEGER,
  fee_fp INTEGER,
  ts INTEGER,
  txhash TEXT,
  blk INTEGER,
  logi INTEGER,
  PRIMARY KEY(address, blk, logi)
);

CREATE INDEX IF NOT EXISTS idx_events_user ON events_norm(user);
CREATE INDEX IF NOT EXISTS idx_events_kind_ts ON events_norm(kind, ts);

DROP VIEW IF EXISTS shares_open;
-- Open outcome shares by user/market/side
CREATE VIEW IF NOT EXISTS shares_open AS
SELECT user, market, side,
  SUM(CASE kind WHEN 'BUY' THEN shares_fp
                WHEN 'SELL' THEN -shares_fp END) AS qty_fp
FROM events_norm
WHERE kind IN ('BUY','SELL')
GROUP BY user, market, side;

DROP VIEW IF EXISTS boosts_live;
-- Boosts live balance
CREATE VIEW IF NOT EXISTS boosts_live AS
SELECT user,
  COALESCE(SUM(CASE kind WHEN 'BOOST_ADD' THEN amount_fp
                         WHEN 'BOOST_REMOVE' THEN -amount_fp END), 0) AS boosts_fp
FROM events_norm
WHERE kind IN ('BOOST_ADD','BOOST_REMOVE')
GROUP BY user;

DROP VIEW IF EXISTS cash_ledger;
-- Wallet cash (escrow)
CREATE VIEW IF NOT EXISTS cash_ledger AS
SELECT user,
  SUM(CASE kind
    WHEN 'DEPOSIT'      THEN amount_fp
    WHEN 'WITHDRAW'     THEN -amount_fp
    WHEN 'BUY'          THEN -amount_fp
    WHEN 'SELL'         THEN  amount_fp
    WHEN 'CLAIM'        THEN  amount_fp
    WHEN 'REFUND'       THEN  amount_fp
    WHEN 'REWARD'       THEN  amount_fp
    WHEN 'BOOST_ADD'    THEN -amount_fp
    WHEN 'BOOST_REMOVE' THEN  amount_fp
  END) AS cash_fp
FROM events_norm
GROUP BY user;

DROP VIEW IF EXISTS wallet_all_time;
-- All-time aggregates
CREATE VIEW IF NOT EXISTS wallet_all_time AS
SELECT user,
  SUM(CASE WHEN kind='BUY'   THEN amount_fp ELSE 0 END) AS total_buys_fp,
  SUM(CASE WHEN kind='CLAIM' THEN amount_fp ELSE 0 END) AS winnings_fp,
  SUM(CASE WHEN kind='REWARD'THEN amount_fp ELSE 0 END) AS rewards_fp
FROM events_norm
GROUP BY user;

CREATE TABLE IF NOT EXISTS indexer_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS resolved_markets(
  market TEXT PRIMARY KEY,
  resolved_ts INTEGER,
  winning_side TEXT
);

CREATE TABLE IF NOT EXISTS market_price(
  market TEXT PRIMARY KEY,
  p_yes_fp INTEGER,
  updated_ts INTEGER
);

CREATE TABLE IF NOT EXISTS claimables(
  user TEXT,
  market TEXT,
  amount_fp INTEGER,
  updated_ts INTEGER,
  PRIMARY KEY(user, market)
);

CREATE TABLE IF NOT EXISTS wallet_stats(
  user TEXT PRIMARY KEY,
  epv_fp INTEGER,
  cash_fp INTEGER,
  claims_fp INTEGER,
  boosts_fp INTEGER,
  win_loss_fp INTEGER,
  total_buys_fp INTEGER,
  rewards_fp INTEGER,
  winnings_fp INTEGER,
  refunds_fp INTEGER,
  updated_ts INTEGER
);

CREATE TABLE IF NOT EXISTS parity_issues(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT,
  reference TEXT,
  expected_fp INTEGER,
  actual_fp INTEGER,
  diff_fp INTEGER,
  ts INTEGER
);

CREATE INDEX IF NOT EXISTS idx_parity_category ON parity_issues(category);

CREATE TABLE IF NOT EXISTS boost_positions(
  user TEXT,
  market TEXT,
  amount_fp INTEGER,
  PRIMARY KEY(user, market)
);

CREATE TABLE IF NOT EXISTS markets(
  market TEXT PRIMARY KEY,
  creator TEXT,
  oracle TEXT,
  question TEXT,
  short_text TEXT,
  end_time INTEGER,
  metadata_json TEXT,
  created_ts INTEGER,
  resolved INTEGER DEFAULT 0,
  winning_side TEXT,
  updated_ts INTEGER
);

CREATE INDEX IF NOT EXISTS idx_markets_resolved ON markets(resolved, end_time);
