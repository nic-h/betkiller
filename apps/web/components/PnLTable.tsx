'use client';

import { useEffect, useState, useTransition } from "react";
import type { LeaderboardRange, PnlRow } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

const RANGES: LeaderboardRange[] = ["24h", "7d", "14d", "30d", "ytd", "all"];

export function PnLTable({ initialRows, initialRange }: { initialRows: PnlRow[]; initialRange: LeaderboardRange }) {
  const [rows, setRows] = useState(initialRows);
  const allowedRanges = new Set<LeaderboardRange>(RANGES);
  const safeInitialRange = allowedRanges.has(initialRange) ? initialRange : "14d";
  const [range, setRange] = useState<LeaderboardRange>(safeInitialRange);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      fetch(`/api/pnl?range=${range}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data?.rows)) {
            const parsed = (data.rows as any[]).map((row) => ({
              ...row,
              reward: Number(row.reward ?? 0) / 1_000_000,
              netFlow: Number(row.netFlow ?? 0) / 1_000_000,
              pnl: Number(row.pnl ?? 0) / 1_000_000
            }));
            setRows(parsed as PnlRow[]);
          }
        })
        .catch(() => {});
    });
  }, [range]);

  return (
    <section className="bk-rounded-lg bk-bg-surface bk-ring-1 bk-ring-border bk-shadow-sm bk-p-4 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-muted">PnL</h2>
          <p className="bk-text-xs bk-text-muted">Net rewards + flows</p>
        </div>
        <div className="bk-flex bk-gap-2">
          {RANGES.map((value) => {
            const label = value === "ytd" ? "YTD" : value === "all" ? "All" : value.toUpperCase();
            return (
            <button
              key={value}
              className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-uppercase bk-tracking-widest ${
                range === value ? "bk-bg-accent bk-text-bg" : "bk-bg-surface2 bk-text-muted"
              }`}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          );})}
        </div>
      </header>
      <div className="bk-border bk-border-border bk-rounded-xl bk-divide-y bk-divide-border/60">
        <div className="bk-grid bk-grid-cols-[3rem,1fr,7rem,7rem,7rem] bk-text-xs bk-uppercase bk-tracking-widest bk-text-muted bk-px-3 bk-py-2">
          <div>#</div>
          <div>Wallet</div>
          <div>Rewards</div>
          <div>Net Flow</div>
          <div>PnL</div>
        </div>
        {rows.map((row, idx) => (
          <div key={row.addr} className="bk-grid bk-grid-cols-[3rem,1fr,7rem,7rem,7rem] bk-items-center bk-px-3 bk-py-2 bk-hover:bg-surface2">
            <div className="bk-text-muted">{idx + 1}</div>
            <div className="bk-flex bk-items-center bk-gap-2">
              <a href={`https://context.markets/u/${row.addr}`} target="_blank" rel="noreferrer" className="bk-text-accent">
                {row.name}
              </a>
              {row.xHandle && (
                <a href={`https://twitter.com/${row.xHandle}`} target="_blank" rel="noreferrer" className="bk-text-muted">
                  @{row.xHandle}
                </a>
              )}
            </div>
            <div className="bk-text-right bk-tabular-nums">{formatMoney(row.reward)}</div>
            <div className={`bk-text-right bk-tabular-nums ${row.netFlow >= 0 ? "bk-text-success" : "bk-text-danger"}`}>
              {formatMoney(row.netFlow)}
            </div>
            <div className={`bk-text-right bk-tabular-nums ${row.pnl >= 0 ? "bk-text-success" : "bk-text-danger"}`}>
              {formatMoney(row.pnl)}
            </div>
          </div>
        ))}
        {rows.length === 0 && <p className="bk-px-3 bk-py-4 bk-text-sm bk-text-muted">No wallets yet.</p>}
      </div>
      {isPending && <p className="bk-text-xs bk-text-muted">Updating…</p>}
    </section>
  );
}
