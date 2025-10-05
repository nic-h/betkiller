'use client';

import { useMemo, useState } from "react";

import type { LeaderboardRow } from "@/lib/db";
import { usd } from "@/lib/num";

export type LeaderboardSortKey = "weightedScore" | "roiPercent" | "netProfit" | "capitalAtRisk";

type SortState = {
  key: LeaderboardSortKey;
  direction: "asc" | "desc";
};

export function Leaderboard({ rows, rangeLabel }: { rows: LeaderboardRow[]; rangeLabel: string }) {
  const [sort, setSort] = useState<SortState>({ key: "weightedScore", direction: "desc" });

  const sortedRows = useMemo(() => {
    const cloned = [...rows];
    const { key, direction } = sort;
    const factor = direction === "asc" ? 1 : -1;

    cloned.sort((a, b) => {
      const diff = (a[key] ?? 0) - (b[key] ?? 0);
      if (diff !== 0) return factor * (diff > 0 ? 1 : -1);
      const scoreDiff = b.weightedScore - a.weightedScore;
      if (scoreDiff !== 0) return scoreDiff;
      return a.addr.localeCompare(b.addr);
    });

    return cloned.slice(0, 50);
  }, [rows, sort]);

  const onSort = (key: LeaderboardSortKey) => {
    setSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "desc" ? "asc" : "desc" };
      }
      return { key, direction: "desc" };
    });
  };

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <header className="bk-flex bk-flex-wrap bk-items-center bk-justify-between">
        <div>
          <p className="bk-text-xs bk-text-brand-muted">Leaderboard</p>
          <h2 className="bk-text-lg bk-font-medium bk-text-brand-text">ROI-weighted PnL ({rangeLabel})</h2>
        </div>
        <p className="bk-text-2xs bk-text-brand-muted">Showing top 50 wallets</p>
      </header>
      <div className="bk-overflow-x-auto bk-rounded-xl bk-border bk-border-brand-ring/40">
        <table className="bk-w-full bk-min-w-[720px] bk-text-sm">
          <thead className="bk-bg-brand-panel">
            <tr className="bk-text-2xs bk-text-brand-muted">
              <th className="bk-px-3 bk-py-2 bk-text-left bk-font-normal">Rank</th>
              <th className="bk-px-3 bk-py-2 bk-text-left bk-font-normal">User</th>
              <SortableHeader label="Net Profit" align="right" active={sort.key === "netProfit"} direction={sort.direction} onClick={() => onSort("netProfit")} />
              <SortableHeader label={`ROI (${rangeLabel})`} align="right" active={sort.key === "roiPercent"} direction={sort.direction} onClick={() => onSort("roiPercent")} />
              <SortableHeader label="Weighted Score" align="right" active={sort.key === "weightedScore"} direction={sort.direction} onClick={() => onSort("weightedScore")} />
              <SortableHeader label="Capital deployed" align="right" active={sort.key === "capitalAtRisk"} direction={sort.direction} onClick={() => onSort("capitalAtRisk")} />
              <th className="bk-px-3 bk-py-2 bk-text-right bk-font-normal">Rewards</th>
              <th className="bk-px-3 bk-py-2 bk-text-right bk-font-normal">Volume</th>
              <th className="bk-px-3 bk-py-2 bk-text-right bk-font-normal">Trades</th>
            </tr>
          </thead>
          <tbody className="bk-divide-y bk-divide-brand-ring/30">
            {sortedRows.map((row, index) => (
              <tr key={row.addr} className="hover:bk-bg-brand-surface/60">
                <td className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">#{row.roiRank || index + 1}</td>
                <td className="bk-px-3 bk-py-2">
                  <a
                    href={`https://context.markets/profile/${row.addr}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bk-text-brand-text hover:bk-text-brand-blue"
                  >
                    {row.name}
                  </a>
                  <p className="bk-text-2xs bk-text-brand-muted">{row.addr}</p>
                </td>
                <td className="bk-px-3 bk-py-2 bk-text-right bk-tabular-nums">{usd(row.netProfit)}</td>
                <td className="bk-px-3 bk-py-2 bk-text-right bk-tabular-nums">{formatPercent(row.roiPercent)}</td>
                <td className="bk-px-3 bk-py-2 bk-text-right bk-tabular-nums">{row.weightedScore.toFixed(2)}</td>
                <td className="bk-px-3 bk-py-2 bk-text-right bk-tabular-nums">{usd(row.capitalAtRisk)}</td>
                <td className="bk-px-3 bk-py-2 bk-text-right bk-tabular-nums">{usd(row.rewards)}</td>
                <td className="bk-px-3 bk-py-2 bk-text-right bk-tabular-nums">{usd(row.volume)}</td>
                <td className="bk-px-3 bk-py-2 bk-text-right bk-tabular-nums">{row.trades.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableHeader({
  label,
  align = "left",
  active,
  direction,
  onClick
}: {
  label: string;
  align?: "left" | "right";
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      className={`bk-px-3 bk-py-2 bk-font-normal ${align === "right" ? "bk-text-right" : "bk-text-left"}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`bk-inline-flex bk-items-center bk-gap-1 bk-text-2xs ${
          active ? "bk-text-brand-text" : "bk-text-brand-muted hover:bk-text-brand-text"
        }`}
      >
        {label}
        {active && <span>{direction === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "–";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}
