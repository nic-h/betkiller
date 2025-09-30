import type { RewardSplit, RewardContribution } from "@/lib/db";
import { formatDateShort, formatMoney } from "@/lib/fmt";

const LABELS: Record<string, string> = {
  TOTAL: "Claims",
  CREATOR: "Creator",
  BOOSTER: "Booster",
  TRADER: "Trader"
};

function summarize(contribution: RewardContribution): string {
  if (contribution.description) return contribution.description;
  switch (contribution.kind) {
    case "create":
      return "Created market";
    case "boost":
      return "Boosted liquidity";
    case "trade":
      return contribution.amount >= 0 ? "Bought" : "Sold";
    case "claim":
      return "Reward claimed";
    default:
      return "Activity";
  }
}

export function RewardActivity({ splits, limit = 12 }: { splits: RewardSplit[]; limit?: number }) {
  const entries = splits.flatMap((split) =>
    split.contributions.map((entry) => ({
      bucket: split.bucket,
      ...entry
    }))
  );

  if (entries.length === 0) {
    return <p className="bk-text-xs bk-text-brand-muted">No recent activity.</p>;
  }

  const sorted = entries.sort((a, b) => b.ts - a.ts).slice(0, limit);

  return (
    <div className="bk-space-y-2">
      <h3 className="bk-text-xs bk-text-brand-muted">Recent actions</h3>
      <ul className="bk-space-y-2 bk-text-xs">
        {sorted.map((entry, index) => (
          <li key={`${entry.bucket}-${entry.ts}-${index}`} className="bk-flex bk-items-start bk-justify-between bk-gap-2">
            <div className="bk-flex bk-flex-col bk-gap-0.5">
              <span className="bk-flex bk-gap-2">
                <span className="bk-rounded-full bk-bg-brand-surface bk-text-brand-muted bk-px-2 bk-py-0.5">
                  {LABELS[entry.bucket] ?? entry.bucket}
                </span>
                <span className="bk-text-brand-text">{summarize(entry)}</span>
              </span>
              {entry.marketId && (
                <a
                  href={`https://context.markets/markets/${entry.marketId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bk-text-brand-blue hover:bk-text-brand-text"
                >
                  {entry.marketTitle ?? entry.marketId}
                </a>
              )}
            </div>
            <div className="bk-text-right bk-flex bk-flex-col bk-gap-0.5">
              <span className="bk-text-brand-text">{formatMoney(entry.amount)}</span>
              <span className="bk-text-2xs bk-text-brand-muted">{formatDateShort(entry.ts)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
