'use client';

import { useEffect, useState, useTransition } from "react";
import type { SlateItem as SlateEntry } from "@/lib/db";
import { formatHoursUntil, formatMoney, formatNumber } from "@/lib/fmt";

export function LiveSlate({ initial }: { initial: SlateEntry[] }) {
  const [entries, setEntries] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch("/api/live-slate")
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data?.items)) setEntries(data.items as SlateEntry[]);
          })
          .catch(() => {});
      });
    };

    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-brand-muted">Live Slate</h2>
        {isPending && <span className="bk-text-xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <div className="bk-grid bk-grid-cols-1 lg:bk-grid-cols-2 bk-gap-3">
        {entries.map((item) => (
          <SlateCard key={item.marketId} item={item} />
        ))}
        {entries.length === 0 && <p className="bk-text-sm bk-text-brand-muted">No markets yet.</p>}
      </div>
    </section>
  );
}

function SlateCard({ item }: { item: SlateEntry }) {
  return (
    <div className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring bk-p-4 bk-space-y-2">
      <div className="bk-flex bk-items-start bk-justify-between">
        <div>
          <a href={`https://context.markets/markets/${item.marketId}`} target="_blank" rel="noreferrer" className="bk-text-brand-blue bk-text-sm">
            {item.title}
          </a>
          <p className="bk-text-xs bk-text-brand-muted">{formatHoursUntil(item.cutoffTs)}</p>
        </div>
        <div className="bk-text-right bk-text-xs bk-text-brand-muted">
          Edge
          <div className="bk-text-lg bk-text-brand-blue bk-tabular-nums">{formatNumber(item.edgeScore, 1)}</div>
        </div>
      </div>
      <div className="bk-flex bk-gap-4 bk-text-xs bk-text-brand-muted">
        <span>Boost {formatMoney(item.boostTotal)}</span>
        <span>Vol 24h {formatMoney(item.volume24h)}</span>
        <span>Traders {item.uniqueTraders24h}</span>
      </div>
      <div className="bk-flex bk-gap-2">
        <a
          className="bk-rounded-full bk-bg-brand-blue/20 bk-text-brand-blue bk-text-xs bk-uppercase bk-tracking-wide bk-px-3 bk-py-1"
          href={`https://context.markets/markets/${item.marketId}?action=boost`}
          target="_blank"
          rel="noreferrer"
        >
          Boost
        </a>
        <a
          className="bk-rounded-full bk-bg-brand-ring bk-text-brand-muted bk-text-xs bk-uppercase bk-tracking-wide bk-px-3 bk-py-1"
          href={`https://context.markets/markets/${item.marketId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open
        </a>
      </div>
    </div>
  );
}
