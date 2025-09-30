import type { RewardSplit } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";
import { RewardActivity } from "@/components/RewardActivity";
import { RewardClaimStatus } from "@/components/RewardClaimStatus";

const BUCKET_LABELS: Record<string, string> = {
  TOTAL: "Claims",
  CREATOR: "Creator",
  BOOSTER: "Booster",
  TRADER: "Trader"
};

export function MyRewardsCard({ address, splits, rangeLabel }: { address: string | null; splits: RewardSplit[]; rangeLabel: string }) {
  const totalReward = splits.reduce((acc, split) => acc + split.reward, 0);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h2 className="bk-text-sm bk-text-brand-muted">My rewards</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Range {rangeLabel}</p>
        </div>
        <span className="bk-text-xs bk-text-brand-muted">Total {formatMoney(totalReward)}</span>
      </header>
      <div className="bk-grid bk-grid-cols-2 bk-gap-2 bk-text-2xs bk-text-brand-muted">
        {splits.map((split) => (
          <div key={split.bucket} className="bk-flex bk-justify-between bk-tabular-nums">
            <span>{BUCKET_LABELS[split.bucket] ?? split.bucket}</span>
            <span>{formatMoney(split.reward)}</span>
          </div>
        ))}
        {splits.length === 0 && <span className="bk-text-2xs">No reward activity in this range.</span>}
      </div>
      <RewardClaimStatus address={address} />
      <RewardActivity splits={splits} limit={5} />
    </section>
  );
}
