export type MetricKey =
  | "capitalAtRisk"
  | "boostAvailable"
  | "boostLocked"
  | "pnl"
  | "rewards";

export type MetricEntry = {
  title: string;
  description: string;
  formula: string;
};

export const METRIC_DICTIONARY: Record<MetricKey, MetricEntry> = {
  capitalAtRisk: {
    title: "Capital deployed",
    description: "Open cost basis that remains active across all markets.",
    formula: "Σ max(total buys − total sells, 0) per market and wallet."
  },
  boostAvailable: {
    title: "Boost available",
    description: "Unlocked boost balance ready to deploy into markets.",
    formula: "Σ unlocked_boost across all markets."
  },
  boostLocked: {
    title: "Locked boost",
    description: "Boost that remains sponsored but not yet unlocked.",
    formula: "Σ max(sponsored − unlocked, 0) across all markets."
  },
  pnl: {
    title: "PnL",
    description: "Realised trading PnL within the selected range.",
    formula: "Σ(usdcOut − usdcIn) for trades in range."
  },
  rewards: {
    title: "Rewards",
    description: "Current claimable rewards reported by the indexer.",
    formula: "Σ live claimable reward balances."
  }
};

export function getMetricCopy(key: MetricKey): MetricEntry {
  return METRIC_DICTIONARY[key];
}
