import type { EventLogEntry } from "@/lib/db";
import { formatDateShort, formatMoney } from "@/lib/fmt";

export function EventLog({ events, errors }: { events: EventLogEntry[]; errors: string[] }) {
  return (
    <footer className="bk-grid bk-grid-cols-1 lg:bk-grid-cols-2 bk-gap-6 bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-6">
      <div className="bk-space-y-3">
        <h2 className="bk-text-sm bk-text-brand-muted">Recent events</h2>
        <div className="bk-space-y-2 bk-text-xs">
          {events.map((event, idx) => {
            const walletHref = event.address ? `https://context.markets/wallets/${event.address}` : null;
            const marketHref = event.marketId ? `https://context.markets/markets/${event.marketId}` : null;
            const amount = typeof event.amount === "number" ? event.amount : null;
            return (
              <div key={idx} className="bk-flex bk-flex-col bk-gap-1">
                <div className="bk-flex bk-justify-between bk-gap-4">
                  <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-1">
                    {event.name && (
                      walletHref ? (
                        <a
                          href={walletHref}
                          target="_blank"
                          rel="noreferrer"
                          className="bk-text-blue-400 hover:bk-text-blue-300"
                        >
                          {event.name}
                        </a>
                      ) : (
                        <span className="bk-text-brand-text">{event.name}</span>
                      )
                    )}
                    {event.name && event.description && <span className="bk-text-brand-muted">·</span>}
                    {event.description && <span>{event.description}</span>}
                    {amount != null && <span>{formatMoney(amount)}</span>}
                  </div>
                  <span>{formatDateShort(event.ts)}</span>
                </div>
                <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-2 bk-text-[11px] bk-text-brand-muted">
                  <span>{event.type}</span>
                  {marketHref && (
                    <a href={marketHref} target="_blank" rel="noreferrer" className="bk-text-blue-400 hover:bk-text-blue-300">
                      {event.marketTitle ?? event.marketId}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
          {events.length === 0 && <p className="bk-text-brand-muted">No events yet.</p>}
        </div>
      </div>
      <div className="bk-space-y-3">
        <h2 className="bk-text-sm bk-text-brand-muted">Errors</h2>
        <div className="bk-space-y-2 bk-text-xs">
          {errors.map((error, idx) => (
            <div key={idx} className="bk-text-brand-orange">{error}</div>
          ))}
          {errors.length === 0 && <p className="bk-text-brand-muted">All clear.</p>}
        </div>
      </div>
    </footer>
  );
}
