'use client';

import { useEffect, useState, useTransition } from "react";
import type { LeaderboardRange, PnlRow } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

function XIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className ?? "bk-h-3 bk-w-3"}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M8 2H1L9.26086 13.0145L1.44995 21.9999H4.09998L10.4883 14.651L16 22H23L14.3917 10.5223L21.8001 2H19.1501L13.1643 8.88578L8 2ZM17 20L5 4H7L19 20H17Z"
      />
    </svg>
  );
}

const RANGES: LeaderboardRange[] = ["24h", "7d", "14d", "30d", "ytd", "all"];

export function PnLTable({
  dense = false,
  initialRows,
  initialRange
}: {
  dense?: boolean;
  initialRows: PnlRow[];
  initialRange: LeaderboardRange;
}) {
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

  const pad = dense ? "bk-px-2 bk-py-1.5" : "bk-px-3 bk-py-2";
  const tableText = dense ? "bk-text-xs" : "bk-text-sm";
  const tableMinWidth = dense ? "bk-min-w-[600px]" : "";

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h2 className="bk-text-sm bk-text-brand-muted">Profit and loss</h2>
          <p className="bk-text-xs bk-text-brand-muted">Net rewards and trade flows</p>
        </div>
        <div className="bk-flex bk-gap-2">
          {RANGES.map((value) => {
            const label = value === "ytd" ? "YTD" : value === "all" ? "All" : value.toUpperCase();
            return (
            <button
              key={value}
              className={`bk-rounded-full bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
                range === value ? "bk-bg-brand-orange bk-text-black" : "bk-bg-brand-surface bk-text-brand-muted hover:bk-text-brand-text"
              }`}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          );})}
        </div>
      </header>
      <div className="bk-border bk-border-brand-ring/60 bk-rounded-xl bk-overflow-auto">
        <table className={`bk-w-full ${tableText} ${tableMinWidth}`.trim()}>
          <thead className="bk-sticky bk-top-14 bk-z-10 bk-bg-brand-panel">
            <tr className="bk-text-xs bk-text-brand-muted">
              <th
                className={`bk-w-12 bk-text-left bk-font-normal ${pad} bk-sticky sm:bk-static bk-left-0 bk-z-20 bk-bg-brand-panel`}
              >
                #
              </th>
              <th
                className={`bk-w-[220px] bk-text-left bk-font-normal ${pad} bk-sticky sm:bk-static bk-left-12 bk-z-20 bk-bg-brand-panel`}
              >
                Wallet
              </th>
              <th className={`bk-text-right bk-font-normal ${pad}`}>Rewards</th>
              <th className={`bk-text-right bk-font-normal ${pad}`}>Net flow</th>
              <th className={`bk-text-right bk-font-normal ${pad}`}>PnL</th>
            </tr>
          </thead>
          <tbody className="bk-divide-y bk-divide-brand-ring/40">
            {rows.map((row, idx) => (
              <tr key={row.addr} className="hover:bk-bg-brand-surface/60">
                <td
                  className={`bk-w-12 bk-text-brand-muted ${pad} bk-sticky sm:bk-static bk-left-0 bk-z-10 bk-bg-brand-panel`}
                >
                  {idx + 1}
                </td>
                <td
                  className={`bk-w-[220px] ${pad} bk-sticky sm:bk-static bk-left-12 bk-z-10 bk-bg-brand-panel`}
                >
                  <div className="bk-flex bk-items-center bk-gap-2">
                    <a href={`https://context.markets/u/${row.addr}`} target="_blank" rel="noreferrer" className="bk-text-brand-blue">
                      {row.name}
                    </a>
                    {row.xHandle && (
                      <a
                        href={`https://twitter.com/${row.xHandle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="bk-inline-flex bk-items-center bk-gap-1 bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
                        aria-label={`@${row.xHandle} on X`}
                      >
                        <XIcon />
                        <span>@{row.xHandle}</span>
                      </a>
                    )}
                  </div>
                </td>
                <td className={`bk-text-right bk-tabular-nums ${pad}`}>{formatMoney(row.reward)}</td>
                <td
                  className={`bk-text-right bk-tabular-nums ${pad} ${
                    row.netFlow >= 0 ? "bk-text-brand-blue" : "bk-text-brand-orange"
                  }`}
                >
                  {formatMoney(row.netFlow)}
                </td>
                <td
                  className={`bk-text-right bk-tabular-nums ${pad} ${
                    row.pnl >= 0 ? "bk-text-brand-blue" : "bk-text-brand-orange"
                  }`}
                >
                  {formatMoney(row.pnl)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className={`${pad} bk-text-sm bk-text-brand-muted`}>
                  No wallets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {isPending && <p className="bk-text-xs bk-text-brand-muted">Updating…</p>}
    </section>
  );
}
