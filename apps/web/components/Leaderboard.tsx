'use client';

import { useEffect, useMemo, useState, useTransition } from "react";
import type { LeaderboardBucket, LeaderboardRange, LeaderboardRow } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/fmt";

const RANGES: LeaderboardRange[] = ["24h", "7d", "14d", "30d", "ytd", "all"];
const BUCKETS: { key: LeaderboardBucket; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "eff", label: "Efficiency" }
];

export function Leaderboard({
  dense = false,
  initialRows,
  initialRange,
  initialBucket
}: {
  dense?: boolean;
  initialRows: LeaderboardRow[];
  initialRange: LeaderboardRange;
  initialBucket: LeaderboardBucket;
}) {
  const [rows, setRows] = useState(initialRows);
  const allowedRanges = new Set<LeaderboardRange>(RANGES);
  const safeInitialRange = allowedRanges.has(initialRange) ? initialRange : "14d";
  const [range, setRange] = useState<LeaderboardRange>(safeInitialRange);
  const allowedBuckets = BUCKETS.map((entry) => entry.key);
  const safeInitialBucket = allowedBuckets.includes(initialBucket) ? initialBucket : 'total';
  const [bucket, setBucket] = useState<LeaderboardBucket>(safeInitialBucket as LeaderboardBucket);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      fetch(`/api/leaderboard?range=${range}&by=${bucket}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data?.rows)) {
            const parsed = (data.rows as any[]).map((row) => ({
              ...row,
              reward: Number(row.reward ?? 0) / 1_000_000,
              rewardCreator: Number(row.rewardCreator ?? row.reward ?? 0) / 1_000_000,
              rewardBooster: Number(row.rewardBooster ?? 0) / 1_000_000,
              rewardTrader: Number(row.rewardTrader ?? 0) / 1_000_000,
              efficiency: Number(row.efficiency ?? 0),
              marketsTouched: Number(row.marketsTouched ?? 0),
              recentRewardTs: row.recentRewardTs ?? null
            }));
            setRows(parsed as LeaderboardRow[]);
          }
        })
        .catch(() => {
          // ignore network errors for now
        });
    });
  }, [range, bucket]);

  const title = useMemo(() => {
    const bucketLabel = BUCKETS.find((b) => b.key === bucket)?.label ?? "Total";
    const rangeLabel = range === "ytd" ? "YTD" : range === "all" ? "All" : range.toUpperCase();
    return `${bucketLabel} — ${rangeLabel}`;
  }, [bucket, range]);

  const pad = dense ? "bk-px-2 bk-py-1.5" : "bk-px-3 bk-py-2";
  const tableText = dense ? "bk-text-xs" : "bk-text-sm";
  const tableMinWidth = dense ? "bk-min-w-[720px]" : "";

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-3">
        <div>
          <p className="bk-text-xs bk-text-brand-muted">Leaderboards</p>
          <p className="bk-text-lg bk-mt-1 bk-text-brand-text">{title}</p>
        </div>
        <div className="bk-flex bk-gap-2 bk-flex-wrap">
          {RANGES.map((value) => {
            const label = value === "ytd" ? "YTD" : value === "all" ? "All" : value.toUpperCase();
            return (
            <button
              key={value}
              className={`bk-rounded-full bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
                range === value ? "bk-bg-brand-blue bk-text-black" : "bk-bg-brand-surface bk-text-brand-muted hover:bk-text-brand-text"
              }`}
              onClick={() => setRange(value)}
            >
              {label}
            </button>
          );})}
        </div>
        <div className="bk-flex bk-gap-2 bk-flex-wrap">
          {BUCKETS.map((option) => (
            <button
              key={option.key}
              className={`bk-rounded-full bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
                bucket === option.key
                  ? "bk-bg-brand-blue bk-text-black"
                  : "bk-bg-brand-surface bk-text-brand-muted hover:bk-text-brand-text"
              }`}
              onClick={() => setBucket(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
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
              <th className={`bk-text-right bk-font-normal ${pad}`}>Total</th>
              <th className={`bk-text-right bk-font-normal ${pad}`}>Creator</th>
              <th className={`bk-text-right bk-font-normal ${pad}`}>Booster</th>
              <th className={`bk-text-right bk-font-normal ${pad}`}>Trader</th>
              <th className={`bk-text-right bk-font-normal ${pad}`}>Efficiency</th>
            </tr>
          </thead>
          <tbody className="bk-divide-y bk-divide-brand-ring/40">
            {rows.map((row, index) => (
              <Row key={row.addr} position={index} row={row} highlight={index === 0} pad={pad} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className={`${pad} bk-text-sm bk-text-brand-muted`}>
                  No data available for this range yet.
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

function Row({
  position,
  row,
  highlight,
  pad
}: {
  position: number;
  row: LeaderboardRow;
  highlight: boolean;
  pad: string;
}) {
  const stickyBg = highlight ? "bk-bg-brand-blue/20" : "bk-bg-brand-panel";
  return (
    <tr className={highlight ? "bk-bg-brand-blue/10" : "hover:bk-bg-brand-surface/60"}>
      <td
        className={`bk-w-12 bk-text-brand-muted ${pad} bk-sticky sm:bk-static bk-left-0 bk-z-10 ${stickyBg}`}
      >
        {position + 1}
      </td>
      <td className={`bk-w-[220px] ${pad} bk-sticky sm:bk-static bk-left-12 bk-z-10 ${stickyBg}`}>
        <div className="bk-flex bk-items-center bk-gap-2">
          <a
            href={`https://context.markets/u/${row.addr}`}
            target="_blank"
            rel="noreferrer"
            className="bk-text-brand-blue"
          >
            {row.name}
          </a>
          {row.xHandle && (
            <a
              href={`https://twitter.com/${row.xHandle}`}
              target="_blank"
              rel="noreferrer"
              className="bk-text-brand-muted"
            >
              @{row.xHandle}
            </a>
          )}
        </div>
        <div className="bk-flex bk-flex-wrap bk-gap-2 bk-text-2xs bk-text-brand-muted">
          <span>Markets {row.marketsTouched}</span>
          <span>Last claim {formatTimeAgo(row.recentRewardTs)}</span>
          <span>Active {formatTimeAgo(row.lastSeen)}</span>
        </div>
      </td>
      <Cell value={row.reward} pad={pad} />
      <Cell value={row.rewardCreator} pad={pad} />
      <Cell value={row.rewardBooster} pad={pad} />
      <Cell value={row.rewardTrader} pad={pad} />
      <td className={`bk-text-right bk-tabular-nums ${pad}`}>{formatNumber(row.efficiency, 3)}x</td>
    </tr>
  );
}

function Cell({ value, pad }: { value: number; pad: string }) {
  return <td className={`bk-text-right bk-tabular-nums ${pad}`}>{formatMoney(value)}</td>;
}

function formatTimeAgo(ts: number | null): string {
  if (!ts) return "—";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - ts);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
