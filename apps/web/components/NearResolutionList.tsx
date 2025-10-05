import type { NearResolutionMarket } from "@/lib/nearResolution";

export function NearResolutionList({ markets }: { markets: NearResolutionMarket[] }) {
  if (!markets.length) {
    return (
      <section className="bk-rounded-2xl bk-bg-slate-900/50 bk-ring-1 bk-ring-slate-800 bk-p-5">
        <header className="bk-mb-2 bk-flex bk-items-center bk-justify-between">
          <h2 className="bk-text-sm bk-font-medium bk-text-slate-200">Near resolution</h2>
          <span className="bk-text-2xs bk-text-slate-500">None pending</span>
        </header>
        <p className="bk-text-2xs bk-text-slate-500">No unresolved markets with a known end time.</p>
      </section>
    );
  }

  return (
    <section className="bk-rounded-2xl bk-bg-slate-900/50 bk-ring-1 bk-ring-slate-800 bk-p-5 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h2 className="bk-text-sm bk-font-medium bk-text-slate-200">Near resolution</h2>
        <span className="bk-text-2xs bk-text-slate-500">Next {markets.length}</span>
      </header>
      <ul className="bk-space-y-3">
        {markets.map((market) => (
          <li key={market.market} className="bk-flex bk-items-start bk-justify-between bk-gap-3">
            <div className="bk-space-y-1">
              <a
                href={`https://context.markets/markets/${market.market}`}
                target="_blank"
                rel="noreferrer"
                className="bk-text-xs bk-font-medium bk-text-slate-200 hover:bk-text-sky-300"
              >
                {market.shortText || market.question || market.market}
              </a>
              <p className="bk-text-2xs bk-text-slate-500">{formatCountdown(market.endTime)}</p>
            </div>
            <div className="bk-text-right bk-text-2xs bk-text-slate-500">
              <p className="bk-font-medium bk-text-slate-200">P(YES) {market.pYes}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatCountdown(endTs: number | null): string {
  if (!endTs) return "No deadline";
  const now = Date.now() / 1000;
  const diff = endTs - now;
  if (diff <= 0) return "Past due";
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
