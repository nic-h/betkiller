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
            if (Array.isArray(data?.rows)) {
              const parsed = (data.rows as any[]).map((entry) => ({
                marketId: entry.marketId,
                title: entry.title,
                cutoffTs: entry.cutoffTs,
                boostTotal: Number(entry.boostTotal ?? 0) / 1_000_000,
                volume24h: Number(entry.volume24h ?? 0) / 1_000_000,
                uniqueTraders24h: Number(entry.uniqueTraders24h ?? 0),
                edgeScore: Number(entry.edgeScore ?? 0),
                tvl: Number(entry.tvl ?? 0) / 1_000_000,
                depth: Number(entry.depth ?? 0) / 1_000_000
              }));
              setEntries(parsed as SlateEntry[]);
            }
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
        <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-muted">Live Slate</h2>
        {isPending && <span className="bk-text-xs bk-text-muted">Refreshing…</span>}
      </header>
      <div className="bk-grid bk-grid-cols-1 lg:bk-grid-cols-2 bk-gap-3">
        {entries.map((item) => (
          <SlateCard key={item.marketId} item={item} />
        ))}
        {entries.length === 0 && <p className="bk-text-sm bk-text-muted">No markets yet.</p>}
      </div>
    </section>
  );
}

function SlateCard({ item }: { item: SlateEntry }) {
  return (
    <div className="bk-rounded-lg bk-bg-surface bk-ring-1 bk-ring-border bk-shadow-sm bk-p-4 bk-space-y-2">
      <div className="bk-flex bk-items-start bk-justify-between">
        <div>
          <a href={`https://context.markets/markets/${item.marketId}`} target="_blank" rel="noreferrer" className="bk-text-accent bk-text-sm">
            {item.title}
          </a>
          <p className="bk-text-xs bk-text-muted">{formatHoursUntil(item.cutoffTs)}</p>
        </div>
        <div className="bk-text-right bk-text-xs bk-text-muted">
          Edge
          <div className="bk-text-lg bk-text-accent bk-tabular-nums">{formatNumber(item.edgeScore, 1)}</div>
        </div>
      </div>
      <div className="bk-flex bk-flex-wrap bk-gap-4 bk-text-xs bk-text-muted">
        <span>TVL {formatMoney(item.tvl)}</span>
        <span>Boost {formatMoney(item.boostTotal)}</span>
        <span>Vol 24h {formatMoney(item.volume24h)}</span>
        <span>Traders {item.uniqueTraders24h}</span>
      </div>
      <div className="bk-flex bk-gap-2">
        <a
          className="bk-rounded-full bk-bg-accent/10 bk-text-accent bk-text-xs bk-uppercase bk-tracking-wide bk-px-3 bk-py-1"
          href={`https://context.markets/markets/${item.marketId}?action=boost`}
          target="_blank"
          rel="noreferrer"
        >
          Boost
        </a>
        <a
          className="bk-rounded-full bk-bg-surface2 bk-text-muted bk-text-xs bk-uppercase bk-tracking-wide bk-px-3 bk-py-1"
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
