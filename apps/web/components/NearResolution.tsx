'use client';

import { useEffect, useState, useTransition } from "react";
import type { NearResolutionItem } from "@/lib/db";
import { formatDateShort } from "@/lib/fmt";

export function NearResolutionList({ initial }: { initial: NearResolutionItem[] }) {
  const [items, setItems] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch("/api/near-resolution")
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data?.items)) setItems(data.items as NearResolutionItem[]);
          })
          .catch(() => {});
      });
    };

    const id = setInterval(refresh, 120_000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring bk-p-4 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-brand-muted">Near Resolution</h2>
        {isPending && <span className="bk-text-xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <div className="bk-space-y-2">
        {items.map((item) => (
          <div key={item.marketId} className="bk-flex bk-items-center bk-justify-between bk-text-sm">
            <a
              href={`https://context.markets/markets/${item.marketId}`}
              target="_blank"
              rel="noreferrer"
              className="bk-text-brand-blue"
            >
              {item.title}
            </a>
            <span className="bk-text-xs bk-text-brand-muted">{formatDateShort(item.cutoffTs)}</span>
          </div>
        ))}
        {items.length === 0 && <p className="bk-text-sm bk-text-brand-muted">Nothing within the next 72h.</p>}
      </div>
    </section>
  );
}
