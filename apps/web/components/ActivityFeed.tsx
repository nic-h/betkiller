'use client';

import { useEffect, useState, useTransition } from "react";

import type { EventLogEntry } from "@/lib/db";
import type { RangeKey } from "@/lib/range";
import { formatDateShort, formatMoney } from "@/lib/fmt";

export function ActivityFeed({ initial, range }: { initial: EventLogEntry[]; range: RangeKey }) {
  const [events, setEvents] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setEvents(initial);
  }, [initial]);

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch(`/api/activity?range=${range}`)
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
          .then((payload) => {
            if (Array.isArray(payload?.rows)) setEvents(payload.rows as EventLogEntry[]);
          })
          .catch(() => {});
      });
    };

    const id = setInterval(refresh, 90_000);
    return () => clearInterval(id);
  }, [range]);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h2 className="bk-text-sm bk-text-brand-muted">Activity</h2>
        {isPending && <span className="bk-text-2xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <ul className="bk-space-y-2">
        {events.map((event) => {
          const walletHref = event.address ? `https://context.markets/wallets/${event.address}` : null;
          const marketHref = event.marketId ? `https://context.markets/markets/${event.marketId}` : null;
          const amount = typeof event.amount === "number" ? event.amount : null;
          const typeLabel = event.type.charAt(0).toUpperCase() + event.type.slice(1);
          const key = `${event.type}-${event.ts}-${event.address ?? event.description}`;
          return (
            <li
              key={key}
              className="bk-flex bk-justify-between bk-gap-4 bk-rounded-2xl bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-px-4 bk-py-3"
            >
              <div className="bk-flex bk-flex-col bk-gap-1">
                <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-1">
                  {event.name && (
                    walletHref ? (
                      <a
                        href={walletHref}
                        target="_blank"
                        rel="noreferrer"
                        className="bk-text-brand-blue hover:bk-text-brand-text"
                      >
                        {event.name}
                      </a>
                    ) : (
                      <span className="bk-text-brand-text">{event.name}</span>
                    )
                  )}
                  {event.name && event.description && <span className="bk-text-brand-muted">·</span>}
                  {event.description && <span className="bk-text-brand-muted">{event.description}</span>}
                  {amount != null && <span className="bk-text-brand-text bk-font-medium">{formatMoney(amount)}</span>}
                </div>
                <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-2 bk-text-2xs bk-text-brand-muted">
                  <span>{typeLabel}</span>
                  {marketHref && (
                    <a href={marketHref} target="_blank" rel="noreferrer" className="bk-text-brand-blue hover:bk-text-brand-text">
                      {event.marketTitle ?? event.marketId}
                    </a>
                  )}
                </div>
              </div>
              <span className="bk-text-2xs bk-text-brand-muted">{formatDateShort(event.ts)}</span>
            </li>
          );
        })}
        {events.length === 0 && <li className="bk-text-xs bk-text-brand-muted">Quiet for this range.</li>}
      </ul>
    </section>
  );
}
