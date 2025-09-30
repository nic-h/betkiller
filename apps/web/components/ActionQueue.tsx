'use client';

import { useEffect, useState, useTransition } from "react";

import type { ActionQueueItem } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";
import type { RangeKey } from "@/lib/range";

const ACTION_META: Record<ActionQueueItem["action"], { label: string; tone: string; cta: string }> = {
  create: { label: "Create", tone: "bk-bg-warning/20 bk-text-warning", cta: "Create" },
  boost: { label: "Boost", tone: "bk-bg-brand-blue/20 bk-text-brand-blue", cta: "Boost" },
  bet: { label: "Bet", tone: "bk-bg-success/20 bk-text-success", cta: "Trade" },
  claim: { label: "Claim", tone: "bk-bg-brand-orange/20 bk-text-brand-orange", cta: "Claim" }
};

export function ActionQueue({ initial, range }: { initial: ActionQueueItem[]; range: RangeKey }) {
  const [items, setItems] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch(`/api/action-queue?range=${range}`)
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
          .then((payload) => {
            if (Array.isArray(payload?.rows)) {
              setItems(payload.rows as ActionQueueItem[]);
            }
          })
          .catch(() => {});
      });
    };

    const interval = setInterval(refresh, 120_000);
    return () => clearInterval(interval);
  }, [range]);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h2 className="bk-text-sm bk-text-brand-muted">Action queue</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Weighted EV × urgency × liquidity gap</p>
        </div>
        {isPending && <span className="bk-text-2xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <div className="bk-space-y-2">
        {items.map((item) => {
          const meta = ACTION_META[item.action];
          const ctaHref = item.ctaHref ?? `https://context.markets/markets/${item.marketId}`;
          const scorePct = Math.round(item.score * 100);
          return (
            <article
              key={item.marketId}
              className="bk-grid bk-grid-cols-[minmax(0,1fr)_auto] bk-items-center bk-gap-3 bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-p-3"
            >
              <div className="bk-space-y-1">
                <div className="bk-flex bk-items-center bk-gap-2">
                  <span className={`bk-rounded-full bk-px-2 bk-py-0.5 bk-text-2xs bk-font-medium ${meta.tone}`}>{meta.label}</span>
                  <span className="bk-text-2xs bk-text-brand-muted">{scorePct}% score</span>
                  <span className="bk-text-2xs bk-text-brand-muted">T-{item.hoursToCutoff.toFixed(1)}h</span>
                </div>
                <a
                  href={ctaHref}
                  target="_blank"
                  rel="noreferrer"
                  className="bk-text-sm bk-text-brand-text hover:bk-text-brand-blue"
                >
                  {item.title}
                </a>
                <p className="bk-text-2xs bk-text-brand-muted">{item.rationale}</p>
                <div className="bk-flex bk-flex-wrap bk-gap-x-4 bk-gap-y-1 bk-text-[11px] bk-text-brand-muted">
                  <span>Edge {item.edgeScore.toFixed(1)}</span>
                  {item.boostGap > 0 && <span>Gap ${item.boostGap.toFixed(0)}</span>}
                  {item.costToMove != null && <span>Δ1pt {formatMoney(item.costToMove)}</span>}
                  {item.claimable != null && <span>Claim ${item.claimable.toFixed(2)}</span>}
                </div>
              </div>
              <a
                href={ctaHref}
                target="_blank"
                rel="noreferrer"
                className="bk-inline-flex bk-items-center bk-justify-center bk-rounded-full bk-bg-brand-blue bk-px-3 bk-py-1 bk-text-xs bk-font-medium bk-text-black hover:bk-bg-brand-blue/90"
              >
                {meta.cta}
              </a>
            </article>
          );
        })}
        {items.length === 0 && <p className="bk-text-xs bk-text-brand-muted">Nothing pressing right now.</p>}
      </div>
    </section>
  );
}
