export type MetricKey = "capital" | "openRisk" | "pnl" | "boosts" | "efficiency";

export type MetricEntry = {
  title: string;
  description: string;
  formula: string;
};

export const METRIC_DICTIONARY: Record<MetricKey, MetricEntry> = {
  capital: {
    title: "Capital",
    description: "Active USDC committed across open market positions.",
    formula: "Σ(usdcIn − usdcOut) across trades within the selected range."
  },
  openRisk: {
    title: "Open Risk",
    description: "Outstanding subsidised boosts that remain locked in markets.",
    formula: "Σ(max(sponsored − unlocked, 0)) across all markets."
  },
  pnl: {
    title: "PnL Today",
    description: "Net profit and loss realised from claims over the active range.",
    formula: "Σ(claim rewards) where ts is within the selected range."
  },
  boosts: {
    title: "Boosts Available",
    description: "Unlocked subsidy you can redeploy immediately.",
    formula: "Σ(unlocked boost USDC) across all markets."
  },
  efficiency: {
    title: "Efficiency",
    description: "Reward yield relative to net USDC put to work by a wallet.",
    formula: "Rewards ÷ net stake volume over the selected range."
  }
};

export function getMetricCopy(key: MetricKey): MetricEntry {
  return METRIC_DICTIONARY[key];
}
