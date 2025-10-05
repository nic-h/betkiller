import type { FP } from "@/lib/fp";

export type LedgerRow = {
  kind: string;
  amount_fp: bigint;
  shares_fp: bigint | null;
  market: string | null;
};

export type Totals = {
  cash: FP;
  claims: FP;
  boosts: FP;
  mtmOpen: FP;
  totalBuys: FP;
  winnings: FP;
  rewards: FP;
  refunds: FP;
  winLoss: FP;
  epv: FP;
};

export function foldLedger(rows: LedgerRow[], claimables: FP, mtmOpen: FP, resolvedMarkets: Set<string>): Totals {
  let cash = 0n;
  let boosts = 0n;
  let totalBuys = 0n;
  let winnings = 0n;
  let rewards = 0n;
  let refunds = 0n;
  let realizedCost = 0n;

  for (const row of rows) {
    const amount = row.amount_fp ?? 0n;
    switch (row.kind) {
      case "DEPOSIT":
        cash += amount;
        break;
      case "WITHDRAW":
        cash -= amount;
        break;
      case "BUY":
        cash -= amount;
        totalBuys += amount;
        if (row.market && resolvedMarkets.has(row.market.toLowerCase())) {
          realizedCost += amount;
        }
        break;
      case "SELL":
        cash += amount;
        break;
      case "CLAIM":
        cash += amount;
        winnings += amount;
        break;
      case "REFUND":
        cash += amount;
        refunds += amount;
        break;
      case "REWARD":
        cash += amount;
        rewards += amount;
        break;
      case "BOOST_ADD":
        cash -= amount;
        boosts += amount;
        break;
      case "BOOST_REMOVE":
        cash += amount;
        boosts -= amount;
        break;
      default:
        break;
    }
  }

  const claims = claimables;
  const winLoss = winnings + refunds - realizedCost;
  const epv = cash + claims + mtmOpen;

  return {
    cash,
    claims,
    boosts,
    mtmOpen,
    totalBuys,
    winnings,
    rewards,
    refunds,
    winLoss,
    epv
  };
}
