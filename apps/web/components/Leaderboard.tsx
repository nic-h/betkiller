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
  initialRows,
  initialRange,
  initialBucket
}: {
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

  return (
    <section className="bk-rounded-lg bk-bg-surface bk-ring-1 bk-ring-border bk-shadow-sm bk-p-5 bk-space-y-4">
      <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-3">
        <div>
          <p className="bk-text-xs bk-uppercase bk-tracking-widest bk-text-muted">Leaderboards</p>
          <p className="bk-text-lg bk-mt-1">{title}</p>
        </div>
        <div className="bk-flex bk-gap-2 bk-flex-wrap">
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
        <div className="bk-flex bk-gap-2 bk-flex-wrap">
          {BUCKETS.map((option) => (
            <button
              key={option.key}
              className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-uppercase bk-tracking-widest ${
                bucket === option.key ? "bk-bg-accent bk-text-bg" : "bk-bg-surface2 bk-text-muted"
              }`}
              onClick={() => setBucket(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="bk-border bk-border-border bk-rounded-xl bk-divide-y bk-divide-border/60">
        <div className="bk-grid bk-grid-cols-[3rem,1fr,8rem,8rem] bk-text-xs bk-uppercase bk-tracking-widest bk-text-muted bk-px-3 bk-py-2">
          <div>#</div>
          <div>Wallet</div>
          <div>Total</div>
          <div>Efficiency</div>
        </div>
        {rows.map((row, index) => (
          <Row key={row.addr} position={index} row={row} highlight={index === 0} />
        ))}
        {rows.length === 0 && (
          <div className="bk-px-4 bk-py-6 bk-text-sm bk-text-muted">No data available for this range yet.</div>
        )}
      </div>
      {isPending && <p className="bk-text-xs bk-text-muted">Updating…</p>}
    </section>
  );
}

function Row({ position, row, highlight }: { position: number; row: LeaderboardRow; highlight: boolean }) {
  return (
    <div
      className={`bk-grid bk-grid-cols-[3rem,1fr,8rem,8rem] bk-items-center bk-px-3 bk-py-2 ${
        highlight ? "bk-bg-accent/10" : "bk-hover:bg-surface2"
      }`}
    >
      <div className="bk-text-muted">{position + 1}</div>
      <div className="bk-flex bk-items-center bk-gap-2">
        <a
          href={`https://context.markets/u/${row.addr}`}
          target="_blank"
          rel="noreferrer"
          className="bk-text-accent"
        >
          {row.name}
        </a>
        {row.xHandle && (
          <a
            href={`https://twitter.com/${row.xHandle}`}
            target="_blank"
            rel="noreferrer"
            className="bk-text-muted"
          >
            @{row.xHandle}
          </a>
        )}
      </div>
      <Cell value={row.reward} />
      <div className="bk-text-right bk-tabular-nums">{formatNumber(row.efficiency, 3)}x</div>
    </div>
  );
}

function Cell({ value }: { value: number }) {
  return <div className="bk-text-right bk-tabular-nums">{formatMoney(value)}</div>;
}
