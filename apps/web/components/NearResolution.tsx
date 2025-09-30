'use client';

import { useEffect, useState, useTransition } from "react";

import type { NearResolutionItem } from "@/lib/db";
import { formatHoursUntil, formatMoney } from "@/lib/fmt";
import type { RangeKey } from "@/lib/range";

export function NearResolutionList({ initial, range }: { initial: NearResolutionItem[]; range: RangeKey }) {
  const [items, setItems] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch(`/api/near-resolution?range=${range}`)
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data?.rows)) setItems(data.rows as NearResolutionItem[]);
          })
          .catch(() => {});
      });
    };

    const id = setInterval(refresh, 120_000);
    return () => clearInterval(id);
  }, [range]);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h2 className="bk-text-sm bk-text-brand-muted">Ending soon</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Markets resolving within the next 72 hours</p>
        </div>
        {isPending && <span className="bk-text-2xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <ul className="bk-space-y-2">
        {items.map((item) => (
          <li
            key={item.marketId}
            className="bk-rounded-2xl bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-p-4 bk-space-y-2"
          >
            <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-2">
              <a
                href={`https://context.markets/markets/${item.marketId}`}
                target="_blank"
                rel="noreferrer"
                className="bk-text-sm bk-text-brand-text hover:bk-text-brand-blue"
              >
                {item.title}
              </a>
              <span className="bk-inline-flex bk-items-center bk-rounded-full bk-bg-warning/15 bk-px-3 bk-py-1 bk-text-2xs bk-text-brand-orange">
                Ends in {formatHoursUntil(item.cutoffTs)}
              </span>
            </div>
            <div className="bk-flex bk-flex-wrap bk-gap-3 bk-text-2xs bk-text-brand-muted">
              <span>TVL {formatMoney(item.tvl)}</span>
              <span>Boost {formatMoney(item.boostTotal)}</span>
              {item.costToMove && item.costToMove.costPerPoint != null && (
                <span>Δ1pt {formatMoney(item.costToMove.costPerPoint)}</span>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="bk-text-xs bk-text-brand-muted">Nothing within the next 72 hours.</li>}
      </ul>
    </section>
  );
}
