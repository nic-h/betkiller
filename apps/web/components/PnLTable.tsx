'use client';

import { useEffect, useState, useTransition } from "react";
import type { LeaderboardRange, PnlRow } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

const RANGES: LeaderboardRange[] = ["24h", "7d", "14d"];

export function PnLTable({ initialRows, initialRange }: { initialRows: PnlRow[]; initialRange: LeaderboardRange }) {
  const [rows, setRows] = useState(initialRows);
  const [range, setRange] = useState<LeaderboardRange>(initialRange);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      fetch(`/api/pnl?range=${range}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data?.rows)) setRows(data.rows as PnlRow[]);
        })
        .catch(() => {});
    });
  }, [range]);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring bk-p-4 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-brand-muted">PnL</h2>
          <p className="bk-text-xs bk-text-brand-muted">Net rewards + flows</p>
        </div>
        <div className="bk-flex bk-gap-2">
          {RANGES.map((value) => (
            <button
              key={value}
              className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-uppercase bk-tracking-widest ${
                range === value ? "bk-bg-brand-orange bk-text-black" : "bk-bg-brand-ring bk-text-brand-muted"
              }`}
              onClick={() => setRange(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </header>
      <div className="bk-border bk-border-brand-ring bk-rounded-xl bk-divide-y bk-divide-brand-ring">
        <div className="bk-grid bk-grid-cols-[3rem,1fr,7rem,7rem,7rem] bk-text-xs bk-uppercase bk-tracking-widest bk-text-brand-muted bk-px-3 bk-py-2">
          <div>#</div>
          <div>Wallet</div>
          <div>Rewards</div>
          <div>Net Flow</div>
          <div>PnL</div>
        </div>
        {rows.map((row, idx) => (
          <div key={row.addr} className="bk-grid bk-grid-cols-[3rem,1fr,7rem,7rem,7rem] bk-items-center bk-px-3 bk-py-2 bk-hover:bg-brand-ring/60">
            <div className="bk-text-brand-muted">{idx + 1}</div>
            <div className="bk-flex bk-items-center bk-gap-2">
              <a href={`https://context.markets/u/${row.addr}`} target="_blank" rel="noreferrer" className="bk-text-brand-blue">
                {row.name}
              </a>
              {row.xHandle && (
                <a href={`https://twitter.com/${row.xHandle}`} target="_blank" rel="noreferrer" className="bk-text-brand-muted">
                  @{row.xHandle}
                </a>
              )}
            </div>
            <div className="bk-text-right bk-tabular-nums">{formatMoney(row.reward)}</div>
            <div className={`bk-text-right bk-tabular-nums ${row.netFlow >= 0 ? "bk-text-brand-blue" : "bk-text-brand-orange"}`}>
              {formatMoney(row.netFlow)}
            </div>
            <div className={`bk-text-right bk-tabular-nums ${row.pnl >= 0 ? "bk-text-brand-blue" : "bk-text-brand-orange"}`}>
              {formatMoney(row.pnl)}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="bk-px-3 bk-py-4 bk-text-sm bk-text-brand-muted">No wallets yet.</p>}
      </div>
      {isPending && <p className="bk-text-xs bk-text-brand-muted">Updating…</p>}
    </section>
  );
}
