import { getDb } from "@/lib/db";
import { formatFP } from "@/lib/fp";
import type { FP } from "@/lib/fp";
import { foldLedger, type LedgerRow, type Totals } from "@/lib/stats";
import { getUnclaimedClaims } from "@/context/claims";
import { getMTMForUser, getSpotPrice } from "@/context/pricing";

export type WalletStatsPayload = {
  estimated_portfolio_value: string;
  cash: string;
  claims: string;
  boosts: string;
  all_time: {
    win_loss: string;
    total_buys: string;
    rewards: string;
    winnings: string;
    refunds: string;
  };
};

export async function computeWalletStatsFP(wallet: string): Promise<Totals> {
  const user = wallet.toLowerCase();
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT kind, amount_fp, shares_fp, market
       FROM events_norm
       WHERE user = ?`
    )
    .all(user)
    .map(mapLedgerRow);

  const markets = Array.from(
    new Set(rows.map((row) => row.market).filter((value): value is string => typeof value === "string" && value.length > 0))
  );

  const resolvedSet = new Set<string>();
  for (const marketId of markets) {
    const state = await getSpotPrice(marketId);
    if (state.resolved) {
      resolvedSet.add(marketId);
    }
  }

  let claimables: FP = 0n;
  let mtmOpen: FP = 0n;

  try {
    claimables = await getUnclaimedClaims(user as `0x${string}`);
  } catch (error) {
    claimables = 0n;
  }

  try {
    mtmOpen = await getMTMForUser(user as `0x${string}`);
  } catch (error) {
    mtmOpen = 0n;
  }

  return foldLedger(rows, claimables, mtmOpen, resolvedSet);
}

export async function persistWalletStats(user: string, totals: Totals): Promise<void> {
  const db = getDb();
  db.prepare(
    `INSERT INTO wallet_stats(
       user,
       epv_fp,
       cash_fp,
       claims_fp,
       boosts_fp,
       win_loss_fp,
       total_buys_fp,
       rewards_fp,
       winnings_fp,
       refunds_fp,
       updated_ts
     ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user) DO UPDATE SET
       epv_fp=excluded.epv_fp,
       cash_fp=excluded.cash_fp,
       claims_fp=excluded.claims_fp,
       boosts_fp=excluded.boosts_fp,
       win_loss_fp=excluded.win_loss_fp,
       total_buys_fp=excluded.total_buys_fp,
       rewards_fp=excluded.rewards_fp,
       winnings_fp=excluded.winnings_fp,
       refunds_fp=excluded.refunds_fp,
       updated_ts=excluded.updated_ts`
  ).run(
    user,
    totals.epv.toString(),
    totals.cash.toString(),
    totals.claims.toString(),
    totals.boosts.toString(),
    totals.winLoss.toString(),
    totals.totalBuys.toString(),
    totals.rewards.toString(),
    totals.winnings.toString(),
    totals.refunds.toString(),
    Math.floor(Date.now() / 1000)
  );

  recordParityIssuesForUser(db, user, totals);
}

export async function getWalletStats(wallet: string): Promise<WalletStatsPayload> {
  const user = wallet.toLowerCase();
  const totals = await computeWalletStatsFP(user);
  await persistWalletStats(user, totals);

  return {
    estimated_portfolio_value: formatFP(totals.epv),
    cash: formatFP(totals.cash),
    claims: formatFP(totals.claims),
    boosts: formatFP(totals.boosts),
    all_time: {
      win_loss: formatFP(totals.winLoss),
      total_buys: formatFP(totals.totalBuys),
      rewards: formatFP(totals.rewards),
      winnings: formatFP(totals.winnings),
      refunds: formatFP(totals.refunds)
    }
  };
}

function mapLedgerRow(row: any): LedgerRow {
  return {
    kind: row.kind,
    amount_fp: toBigInt(row.amount_fp),
    shares_fp: row.shares_fp !== null && row.shares_fp !== undefined ? BigInt(row.shares_fp) : null,
    market: typeof row.market === "string" ? row.market.toLowerCase() : null
  };
}

function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  return 0n;
}

function recordParityIssuesForUser(db: ReturnType<typeof getDb>, user: string, totals: Totals) {
  const ledgerCashRow = db.prepare(`SELECT cash_fp FROM cash_ledger WHERE user = ?`).get(user) as { cash_fp?: string } | undefined;
  const ledgerCash = ledgerCashRow?.cash_fp !== undefined ? BigInt(ledgerCashRow.cash_fp) : 0n;
  recordDiff(db, "cash", user, ledgerCash, totals.cash);

  const ledgerBoostsRow = db.prepare(`SELECT boosts_fp FROM boosts_live WHERE user = ?`).get(user) as { boosts_fp?: string } | undefined;
  const ledgerBoosts = ledgerBoostsRow?.boosts_fp !== undefined ? BigInt(ledgerBoostsRow.boosts_fp) : 0n;
  recordDiff(db, "boosts", user, ledgerBoosts, totals.boosts);

  const claimablesRow = db.prepare(`SELECT COALESCE(SUM(amount_fp),0) AS amount FROM claimables WHERE user = ?`).get(user) as { amount?: string } | undefined;
  const claimables = claimablesRow?.amount !== undefined ? BigInt(claimablesRow.amount) : 0n;
  recordDiff(db, "claims", user, claimables, totals.claims);
}

function recordDiff(
  db: ReturnType<typeof getDb>,
  category: string,
  reference: string,
  expected: bigint,
  actual: bigint
) {
  const diff = actual - expected;
  const absDiff = diff >= 0n ? diff : -diff;
  const deleteStmt = db.prepare(`DELETE FROM parity_issues WHERE category = ? AND reference = ?`);
  deleteStmt.run(category, reference);
  if (absDiff > 1n) {
    db.prepare(
      `INSERT INTO parity_issues(category, reference, expected_fp, actual_fp, diff_fp, ts)
       VALUES(?, ?, ?, ?, ?, ?)`
    ).run(category, reference, expected.toString(), actual.toString(), diff.toString(), Math.floor(Date.now() / 1000));
  }
}
