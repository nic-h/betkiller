'use client';

import { useEffect, useState, useTransition } from "react";
import type { LiquidityHoleItem } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

export function LiquidityHoles({ initial }: { initial: LiquidityHoleItem[] }) {
  const [items, setItems] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch("/api/liquidity-holes")
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
          .then((payload) => {
            if (Array.isArray(payload?.rows)) {
              setItems(payload.rows as LiquidityHoleItem[]);
            }
          })
          .catch(() => {});
      });
    };
    const timer = setInterval(refresh, 180_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div className="bk-space-y-1">
          <h2 className="bk-text-sm bk-text-brand-muted">Liquidity holes</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Where boost capital unlocks the biggest gaps</p>
        </div>
        {isPending && <span className="bk-text-2xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <div className="bk-grid bk-grid-cols-1 md:bk-grid-cols-2 bk-gap-3">
        {items.map((item) => (
          <article key={item.marketId} className="bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-p-4 bk-space-y-2">
            <div className="bk-flex bk-items-start bk-justify-between bk-gap-3">
              <div>
                <a
                  href={`https://context.markets/markets/${item.marketId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bk-text-brand-text bk-text-sm hover:bk-text-brand-blue"
                >
                  {item.title}
                </a>
                <p className="bk-text-2xs bk-text-brand-muted">Needs ${item.boostGap.toFixed(0)} in boost • cutoff {item.hoursToCutoff.toFixed(1)} h</p>
              </div>
              <span className="bk-rounded-full bk-bg-brand-blue/10 bk-text-brand-blue bk-text-2xs bk-font-medium bk-px-3 bk-py-1">
                Edge {item.edgeScore.toFixed(1)}
              </span>
            </div>
            <div className="bk-grid bk-grid-cols-2 bk-gap-2 bk-text-2xs bk-text-brand-muted">
              <Metric label="TVL" value={formatMoney(item.tvl)} />
              <Metric label="Boost" value={`${formatMoney(item.boostTotal)} / $${item.boostTarget.toFixed(0)}`} />
              <Metric label="Gap" value={`$${item.boostGap.toFixed(0)}`} />
              {item.costToMove != null && <Metric label="Δ1pt cost" value={formatMoney(item.costToMove)} />}
            </div>
          </article>
        ))}
        {items.length === 0 && <p className="bk-text-xs bk-text-brand-muted">Boost coverage looks solid across the board.</p>}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="bk-text-[10px] bk-text-brand-muted bk-uppercase">{label}</p>
      <p className="bk-text-xs bk-text-brand-text bk-tabular-nums">{value}</p>
    </div>
  );
}
