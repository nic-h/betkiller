import type { CompetitorEntry } from "@/lib/db";
import { formatMoney, formatNumber, formatDateShort } from "@/lib/fmt";

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className ?? "bk-h-3 bk-w-3"}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 2H1L9.26086 13.0145L1.44995 21.9999H4.09998L10.4883 14.651L16 22H23L14.3917 10.5223L21.8001 2H19.1501L13.1643 8.88578L8 2ZM17 20L5 4H7L19 20H17Z"
      />
    </svg>
  );
}

function formatTimeAgo(ts: number | null): string {
  if (!ts) return "—";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shortAddress(addr: string): string {
  if (!addr) return "";
  return addr.length <= 10 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function MetricChip({
  label,
  value,
  tone = "muted"
}: {
  label: string;
  value: string;
  tone?: "muted" | "accent" | "warning";
}) {
  const toneClass =
    tone === "accent"
      ? "bk-bg-brand-blue/15 bk-text-brand-blue"
      : tone === "warning"
      ? "bk-bg-warning/15 bk-text-brand-orange"
      : "bk-bg-brand-panel bk-text-brand-muted";
  return (
    <span className={`bk-inline-flex bk-items-center bk-gap-1 bk-rounded-full bk-px-3 bk-py-1 bk-text-2xs ${toneClass}`}>
      <span>{label}</span>
      <span className="bk-text-brand-text">{value}</span>
    </span>
  );
}

export function CompetitorWatch({ entries }: { entries: CompetitorEntry[] }) {
  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <div className="bk-flex bk-items-center bk-justify-between bk-gap-3">
        <div>
          <h2 className="bk-text-sm bk-text-brand-muted">Competitor watch</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Who’s moving size and where their boosts are deployed.</p>
        </div>
      </div>
      <div className="bk-grid lg:bk-grid-cols-2 bk-gap-3">
        {entries.map((entry) => {
          const rewardChipTone = entry.reward14d > 0 ? "warning" : "muted";
          return (
            <article
              key={entry.addr}
              className="bk-rounded-2xl bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-p-4 bk-space-y-3"
            >
              <div className="bk-flex bk-flex-wrap bk-items-start bk-justify-between bk-gap-3">
                <div className="bk-space-y-1">
                  <div className="bk-flex bk-items-center bk-gap-2">
                    <a
                      href={`https://context.markets/u/${entry.addr}`}
                      target="_blank"
                      rel="noreferrer"
                      className="bk-text-brand-blue bk-text-sm hover:bk-text-brand-orange"
                    >
                      {entry.name}
                    </a>
                    {entry.xHandle && (
                      <a
                        href={`https://twitter.com/${entry.xHandle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bk-inline-flex bk-items-center bk-gap-1 bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
                        aria-label={`@${entry.xHandle} on X`}
                      >
                        <XIcon />
                        <span>@{entry.xHandle}</span>
                      </a>
                    )}
                  </div>
                </div>
                <MetricChip label="Reward 14d" value={formatMoney(entry.reward14d)} tone={rewardChipTone} />
              </div>

              <div className="bk-flex bk-flex-wrap bk-gap-2">
                <MetricChip label="Efficiency" value={`${formatNumber(entry.efficiency, 2)}x`} tone="accent" />
                {entry.typicalTradeSize != null && (
                  <MetricChip label="Avg trade" value={formatMoney(entry.typicalTradeSize)} />
                )}
                {entry.claimRate != null && (
                  <MetricChip label="Claim rate" value={`${(entry.claimRate * 100).toFixed(1)}%`} />
                )}
                <MetricChip label="Markets 7d" value={`${entry.recentMarketCount}`} />
                <MetricChip label="Net boost" value={formatMoney(entry.netBoost)} tone="warning" />
                {entry.lastActiveTs && (
                  <MetricChip label="Last move" value={formatTimeAgo(entry.lastActiveTs)} />
                )}
                {entry.overlapCount > 0 && (
                  <MetricChip label="Overlap" value={`${entry.overlapCount}`} tone="accent" />
                )}
              </div>

              {entry.overlapCount > 0 && (
                <p className="bk-text-2xs bk-text-brand-muted">
                  Shared markets: {entry.overlapMarkets.slice(0, 4).join(", ")}
                </p>
              )}

              <div className="bk-space-y-2">
                {entry.markets.slice(0, 3).map((market, index) => {
                  const highlight = index === 0;
                  return (
                    <div
                      key={market.marketId}
                      className={`bk-rounded-xl bk-border bk-p-3 bk-space-y-1 ${
                        highlight ? "bk-border-warning/40 bk-bg-warning/5" : "bk-border-brand-ring/30 bk-bg-brand-panel"
                      }`}
                    >
                      <div className="bk-flex bk-items-center bk-justify-between bk-gap-2">
                        <a
                          href={`https://context.markets/markets/${market.marketId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="bk-text-sm bk-text-brand-text hover:bk-text-brand-blue"
                        >
                          {market.title}
                        </a>
                        <span className="bk-text-2xs bk-text-brand-muted">{formatDateShort(market.createdAt)}</span>
                      </div>
                      <div className="bk-flex bk-flex-wrap bk-gap-3 bk-text-2xs bk-text-brand-muted">
                        <span>Boost {formatMoney(market.boostTotal)}</span>
                        <span>
                          Clarity {market.ruleClarity != null ? `${Math.round(market.ruleClarity * 100)}%` : "n/a"}
                        </span>
                        {market.settlementRisk != null && (
                          <span>Settlement {Math.round(market.settlementRisk * 100)}%</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
        {entries.length === 0 && (
          <p className="bk-text-sm bk-text-brand-muted">No competitor data yet.</p>
        )}
      </div>
    </section>
  );
}
