import type { CompetitorEntry } from "@/lib/db";
import { formatMoney, formatDateShort } from "@/lib/fmt";

export function CompetitorWatch({ entries }: { entries: CompetitorEntry[] }) {
  return (
    <section className="bk-rounded-lg bk-bg-surface bk-ring-1 bk-ring-border bk-shadow-sm bk-p-4 bk-space-y-3">
      <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-muted">Competitor Watch</h2>
      <div className="bk-space-y-3">
        {entries.map((entry) => (
          <div key={entry.addr} className="bk-space-y-1">
            <div className="bk-flex bk-items-center bk-gap-2">
              <a href={`https://context.markets/u/${entry.addr}`} target="_blank" rel="noreferrer" className="bk-text-accent">
                {entry.name}
              </a>
              {entry.xHandle && (
                <a href={`https://twitter.com/${entry.xHandle}`} target="_blank" rel="noreferrer" className="bk-text-muted">
                  @{entry.xHandle}
                </a>
              )}
            </div>
            <div className="bk-space-y-1 bk-text-xs bk-text-muted">
              {entry.markets.slice(0, 3).map((market) => (
                <div key={market.marketId} className="bk-flex bk-justify-between">
                  <a
                    href={`https://context.markets/markets/${market.marketId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bk-text-accent"
                  >
                    {market.title}
                  </a>
                  <span>{formatDateShort(market.createdAt)} • Boost {formatMoney(market.boostTotal)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {entries.length === 0 && <p className="bk-text-sm bk-text-muted">No competitor data yet.</p>}
      </div>
    </section>
  );
}
