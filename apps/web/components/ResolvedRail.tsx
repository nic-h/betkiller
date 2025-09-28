import type { ResolvedMarket } from "@/lib/db";
import { formatDateShort, formatMoney } from "@/lib/fmt";

function formatPercentage(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

export function ResolvedRail({ items }: { items: ResolvedMarket[] }) {
  if (!items.length) {
    return (
      <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
        <h2 className="bk-text-sm bk-text-brand-muted">Recently resolved</h2>
        <p className="bk-text-sm bk-text-brand-muted">No resolutions yet.</p>
      </section>
    );
  }

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <h2 className="bk-text-sm bk-text-brand-muted">Recently resolved</h2>
      <div className="bk-space-y-3">
        {items.map((item) => {
          const winner = item.outcomes.reduce<{ name: string; payout: number } | null>((acc, current) => {
            if (!acc || current.payout > acc.payout) return current;
            return acc;
          }, null);

          return (
            <div key={item.marketId} className="bk-border bk-border-brand-ring/40 bk-rounded-xl bk-p-3 bk-space-y-2">
              <div className="bk-flex bk-items-center bk-justify-between">
                <a
                  className="bk-text-sm bk-text-brand-blue hover:bk-text-brand-text"
                  href={`https://context.markets/markets/${item.marketId}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.title}
                </a>
                <span className="bk-text-2xs bk-text-brand-muted">{formatDateShort(item.resolvedAt)}</span>
              </div>
              {winner && (
                <div className="bk-flex bk-items-center bk-gap-2 bk-text-xs">
                  <span className="bk-rounded-full bk-bg-brand-surface bk-text-brand-text bk-px-2 bk-py-0.5">Winner</span>
                  <span className="bk-text-brand-muted">{winner.name}</span>
                  <span className="bk-text-brand-muted">{formatPercentage(winner.payout)}</span>
                </div>
              )}
              <div className="bk-flex bk-flex-wrap bk-gap-3 bk-text-2xs bk-text-brand-muted">
                {item.outcomes.map((outcome, index) => (
                  <div key={index} className="bk-flex bk-gap-1">
                    <span>{outcome.name}:</span>
                    <span>{formatPercentage(outcome.payout)}</span>
                  </div>
                ))}
              </div>
              <div className="bk-flex bk-flex-wrap bk-gap-4 bk-text-2xs bk-text-brand-muted">
                <span>Surplus {formatMoney(item.surplus)}</span>
                <span>Redeemed {formatMoney(item.totalRedeemed)}</span>
                <span>{item.redeemerCount} wallets</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
