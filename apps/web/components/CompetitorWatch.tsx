import type { CompetitorEntry } from "@/lib/db";
import { formatMoney, formatNumber, formatDateShort } from "@/lib/fmt";

function formatTimeAgo(ts: number | null): string {
  if (!ts) return "—";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function CompetitorWatch({ entries }: { entries: CompetitorEntry[] }) {
  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
      <h2 className="bk-text-sm bk-text-brand-muted">Competitor watch</h2>
      <div className="bk-space-y-3">
        {entries.map((entry) => (
          <div key={entry.addr} className="bk-space-y-1">
            <div className="bk-flex bk-items-center bk-gap-2">
              <a href={`https://context.markets/u/${entry.addr}`} target="_blank" rel="noreferrer" className="bk-text-brand-blue">
                {entry.name}
              </a>
              {entry.xHandle && (
                <a href={`https://twitter.com/${entry.xHandle}`} target="_blank" rel="noreferrer" className="bk-text-brand-muted">
                  @{entry.xHandle}
                </a>
              )}
            </div>
            <div className="bk-flex bk-flex-wrap bk-gap-x-4 bk-gap-y-1 bk-text-xs bk-text-brand-muted">
              <span>Reward 14d {formatMoney(entry.reward14d)}</span>
              <span>Efficiency {formatNumber(entry.efficiency, 2)}x</span>
              {entry.typicalTradeSize != null && <span>Avg trade {formatMoney(entry.typicalTradeSize)}</span>}
              {entry.claimRate != null && <span>Claim rate {(entry.claimRate * 100).toFixed(1)}%</span>}
              {entry.overlapCount > 0 && <span>Overlap {entry.overlapCount}</span>}
              {entry.lastActiveTs && <span>Last move {formatTimeAgo(entry.lastActiveTs)}</span>}
              <span>Markets 7d {entry.recentMarketCount}</span>
              <span>Net boost {formatMoney(entry.netBoost)}</span>
            </div>
            {entry.overlapCount > 0 && (
              <div className="bk-text-xs bk-text-brand-muted">
                Shared markets: {entry.overlapMarkets.slice(0, 4).join(", ")}
              </div>
            )}
            <div className="bk-space-y-1 bk-text-xs bk-text-brand-muted">
              {entry.markets.slice(0, 3).map((market) => (
                <div key={market.marketId} className="bk-flex bk-justify-between bk-gap-2">
                  <a
                    href={`https://context.markets/markets/${market.marketId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bk-text-brand-text hover:bk-text-brand-blue"
                  >
                    {market.title}
                  </a>
                  <span className="bk-text-right">
                    {formatDateShort(market.createdAt)} • Boost {formatMoney(market.boostTotal)} • Clarity {market.ruleClarity != null
                      ? `${Math.round(market.ruleClarity * 100)}%`
                      : "n/a"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="bk-text-sm bk-text-brand-muted">No competitor data yet.</p>}
      </div>
    </section>
  );
}
