'use client';

import { useEffect, useState, useTransition } from "react";
import type { ActionQueueItem } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

const ACTION_LABELS: Record<ActionQueueItem["action"], { label: string; className: string }> = {
  boost: { label: "Boost", className: "bk-bg-brand-blue/20 bk-text-brand-blue" },
  bet: { label: "Bet", className: "bk-bg-success/20 bk-text-success" },
  monitor: { label: "Monitor", className: "bk-bg-warning/20 bk-text-warning" }
};

export function ActionQueue({ initial }: { initial: ActionQueueItem[] }) {
  const [items, setItems] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch("/api/action-queue")
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
  }, []);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div className="bk-space-y-1">
          <h2 className="bk-text-sm bk-text-brand-muted">Action queue</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Ranked playbook for the next moves</p>
        </div>
        {isPending && <span className="bk-text-2xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <div className="bk-space-y-3">
        {items.map((item) => {
          const meta = ACTION_LABELS[item.action];
          return (
            <article
              key={item.marketId}
              className="bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-p-4 bk-space-y-2"
            >
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
                  <p className="bk-text-2xs bk-text-brand-muted bk-mt-1">Due in {item.hoursToCutoff.toFixed(1)} h</p>
                </div>
                <span className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-2xs bk-font-medium ${meta.className}`}>
                  {meta.label}
                </span>
              </div>
              <p className="bk-text-xs bk-text-brand-muted">{item.rationale}</p>
              <div className="bk-grid bk-grid-cols-2 md:bk-grid-cols-4 bk-gap-2 bk-text-2xs bk-text-brand-muted">
                <Metric label="Edge" value={item.edgeScore.toFixed(1)} />
                <Metric label="Score" value={item.score.toFixed(2)} />
                <Metric label="TVL" value={formatMoney(item.tvl)} />
                <Metric label="Boost" value={`${formatMoney(item.boostTotal)} / $${item.boostTarget.toFixed(0)}`} />
                {item.costToMove != null && <Metric label="Δ1pt cost" value={formatMoney(item.costToMove)} />}
                {item.clarityScore != null && <Metric label="Clarity" value={item.clarityScore.toFixed(2)} />}
              </div>
            </article>
          );
        })}
        {items.length === 0 && <p className="bk-text-xs bk-text-brand-muted">Nothing pressing right now.</p>}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="bk-text-[10px] bk-uppercase bk-text-brand-muted">{label}</p>
      <p className="bk-text-xs bk-text-brand-text bk-tabular-nums">{value}</p>
    </div>
  );
}
