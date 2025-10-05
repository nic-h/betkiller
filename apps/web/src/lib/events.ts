import { getDb } from "@/lib/db";
import type { TimeRangeKey } from "@/lib/timeRange";
import { rangeToSeconds } from "@/lib/timeRange";

export type NormalizedRow = {
  address: string;
  user: string;
  market: string | null;
  kind: string;
  side: string | null;
  amount_fp: string | null;
  shares_fp: string | null;
  fee_fp: string | null;
  ts: number;
  txhash: string;
  blk: number;
  logi: number;
};

function mapRow(row: any): NormalizedRow {
  return {
    address: row.address,
    user: row.user,
    market: row.market ?? null,
    kind: row.kind,
    side: row.side ?? null,
    amount_fp: row.amount_fp !== null ? String(row.amount_fp) : null,
    shares_fp: row.shares_fp !== null ? String(row.shares_fp) : null,
    fee_fp: row.fee_fp !== null ? String(row.fee_fp) : null,
    ts: Number(row.ts ?? 0),
    txhash: row.txhash,
    blk: Number(row.blk ?? 0),
    logi: Number(row.logi ?? 0)
  };
}

export function getWalletEvents(wallet: string, range: TimeRangeKey, limit = 30): NormalizedRow[] {
  const db = getDb();
  const seconds = rangeToSeconds(range);
  const cutoff = Math.floor(Date.now() / 1000) - seconds;
  const stmt = db.prepare(
    `SELECT address, user, market, kind, side, amount_fp, shares_fp, fee_fp, ts, txhash, blk, logi
     FROM events_norm
     WHERE user = ? AND ts >= ?
     ORDER BY ts DESC
     LIMIT ?`
  );
  return stmt.all(wallet.toLowerCase(), cutoff, limit).map(mapRow);
}

export function getWalletEventLog(wallet: string, limit = 100): NormalizedRow[] {
  const db = getDb();
  const stmt = db.prepare(
    `SELECT address, user, market, kind, side, amount_fp, shares_fp, fee_fp, ts, txhash, blk, logi
     FROM events_norm
     WHERE user = ?
     ORDER BY ts DESC
     LIMIT ?`
  );
  return stmt.all(wallet.toLowerCase(), limit).map(mapRow);
}
