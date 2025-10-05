import type { MarketSummary } from "@/lib/db";
import { usd } from "@/lib/num";
import { Sparkline } from "@/components/Sparkline";

export function MarketsPanel({ markets }: { markets: MarketSummary[] }) {
  if (!markets.length) {
    return (
      <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-6">
        <p className="bk-text-sm bk-text-brand-muted">No markets matched the current filters.</p>
      </section>
    );
  }

  return (
    <section className="bk-space-y-4">
      <header className="bk-flex bk-items-center bk-justify-between bk-gap-4">
        <div>
          <h2 className="bk-text-sm bk-font-medium bk-text-brand-text">Live markets</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Ranked by locked boost, TVL, and 24h volume</p>
        </div>
        <span className="bk-text-2xs bk-text-brand-muted">Showing {markets.length}</span>
      </header>
      <div className="bk-space-y-3">
        {markets.map((market) => (
          <MarketCard key={market.marketId} market={market} />
        ))}
      </div>
    </section>
  );
}

type MarketCardProps = {
  market: MarketSummary;
};

function MarketCard({ market }: MarketCardProps) {
  const countdown = formatCountdown(market.cutoffTs);
  const edgeTooltip = `Boost ${market.boostLocked.toFixed(2)} · TVL ${market.tvl.toFixed(2)} · Vol ${market.volume24h.toFixed(2)}`;

  return (
    <article className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <div className="bk-flex bk-items-start bk-justify-between bk-gap-4">
        <div className="bk-space-y-1">
          <a
            href={`https://context.markets/markets/${market.marketId}`}
            target="_blank"
            rel="noreferrer"
            className="bk-text-sm bk-font-medium bk-text-brand-text hover:bk-text-brand-blue"
          >
            {market.title}
          </a>
          <p className="bk-text-2xs bk-text-brand-muted">{countdown}</p>
        </div>
        <div className="bk-text-right bk-text-xs bk-text-brand-muted" title={edgeTooltip}>
          <p>Edge</p>
          <p className="bk-text-lg bk-font-semibold bk-text-brand-blue bk-tabular-nums">{market.edgeScore.toFixed(2)}</p>
        </div>
      </div>

      <div className="bk-grid bk-grid-cols-1 sm:bk-grid-cols-2 bk-gap-3">
        <MetricSparkline
          label="Price (YES)"
          value={market.lastPriceYes != null ? `${(market.lastPriceYes * 100).toFixed(1)}%` : "–"}
          series={market.priceSeries}
        />
        <MetricSparkline label="TVL" value={usd(market.tvl)} series={market.tvlSeries} accent="orange" />
      </div>

      <p className="bk-text-2xs bk-text-brand-muted">
        Boost {usd(market.boostLocked)} · 24h Vol {usd(market.volume24h)} · Traders {formatNumber(market.traderCount)}
      </p>
    </article>
  );
}

type MetricSparklineProps = {
  label: string;
  value: string;
  series: number[];
  accent?: "orange" | "blue";
};

function MetricSparkline({ label, value, series, accent = "blue" }: MetricSparklineProps) {
  const stroke = accent === "orange" ? "bk-stroke-brand-orange" : "bk-stroke-brand-blue";
  const fill = accent === "orange" ? "bk-fill-brand-orange/20" : "bk-fill-brand-blue/15";

  return (
    <div className="bk-rounded-xl bk-bg-brand-surface bk-p-3 bk-space-y-2">
      <div className="bk-flex bk-items-center bk-justify-between bk-text-2xs bk-text-brand-muted">
        <span>{label}</span>
        <span>{value}</span>
      </div>
      <Sparkline values={series} height={36} strokeClass={stroke} fillClass={fill} />
    </div>
  );
}

function formatCountdown(cutoffTs: number): string {
  const now = Date.now() / 1000;
  const diff = cutoffTs - now;
  if (diff <= 0) return "Settled";
  const hours = Math.floor(diff / 3600);
  if (hours >= 48) {
    const days = Math.round(hours / 24);
    return `T-${days}d`;
  }
  if (hours >= 1) {
    return `T-${hours}h`;
  }
  const minutes = Math.max(1, Math.round(diff / 60));
  return `T-${minutes}m`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value >= 1000) return value.toLocaleString();
  return String(value);
}
