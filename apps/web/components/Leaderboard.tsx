'use client';

import { useEffect, useMemo, useState, useTransition } from "react";
import type { LeaderboardBucket, LeaderboardRange, LeaderboardRow } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/fmt";

const RANGES: LeaderboardRange[] = ["24h", "7d", "14d"];
const BUCKETS: { key: LeaderboardBucket; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "creator", label: "Creator" },
  { key: "booster", label: "Booster" },
  { key: "trader", label: "Trader" },
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
  const [range, setRange] = useState<LeaderboardRange>(initialRange);
  const [bucket, setBucket] = useState<LeaderboardBucket>(initialBucket);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    startTransition(() => {
      fetch(`/api/leaderboard?range=${range}&by=${bucket}`)
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data?.rows)) {
            setRows(data.rows as LeaderboardRow[]);
          }
        })
        .catch(() => {
          // ignore network errors for now
        });
    });
  }, [range, bucket]);

  const title = useMemo(() => {
    const bucketLabel = BUCKETS.find((b) => b.key === bucket)?.label ?? "Total";
    return `${bucketLabel} — ${range}`;
  }, [bucket, range]);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring bk-p-5 bk-space-y-4">
      <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-3">
        <div>
          <p className="bk-text-xs bk-uppercase bk-tracking-widest bk-text-brand-muted">Leaderboards</p>
          <p className="bk-text-lg bk-mt-1">{title}</p>
        </div>
        <div className="bk-flex bk-gap-2 bk-flex-wrap">
          {RANGES.map((value) => (
            <button
              key={value}
              className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-uppercase bk-tracking-widest ${
                range === value ? "bk-bg-brand-blue bk-text-black" : "bk-bg-brand-ring bk-text-brand-muted"
              }`}
              onClick={() => setRange(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="bk-flex bk-gap-2 bk-flex-wrap">
          {BUCKETS.map((option) => (
            <button
              key={option.key}
              className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-uppercase bk-tracking-widest ${
                bucket === option.key ? "bk-bg-brand-blue bk-text-black" : "bk-bg-brand-ring bk-text-brand-muted"
              }`}
              onClick={() => setBucket(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="bk-border bk-border-brand-ring bk-rounded-xl bk-divide-y bk-divide-brand-ring">
        <div className="bk-grid bk-grid-cols-[3rem,1fr,8rem,8rem,8rem,8rem,8rem] bk-text-xs bk-uppercase bk-tracking-widest bk-text-brand-muted bk-px-3 bk-py-2">
          <div>#</div>
          <div>Wallet</div>
          <div>Total</div>
          <div>Creator</div>
          <div>Booster</div>
          <div>Trader</div>
          <div>Efficiency</div>
        </div>
        {rows.map((row, index) => (
          <Row key={row.addr} position={index} row={row} highlight={index === 0} />
        ))}
        {rows.length === 0 && (
          <div className="bk-px-4 bk-py-6 bk-text-sm bk-text-brand-muted">No data available for this range yet.</div>
        )}
      </div>
      {isPending && <p className="bk-text-xs bk-text-brand-muted">Updating…</p>}
    </section>
  );
}

function Row({ position, row, highlight }: { position: number; row: LeaderboardRow; highlight: boolean }) {
  return (
    <div
      className={`bk-grid bk-grid-cols-[3rem,1fr,8rem,8rem,8rem,8rem,8rem] bk-items-center bk-px-3 bk-py-2 ${
        highlight ? "bk-bg-brand-blue/10" : "bk-hover:bg-brand-ring/60"
      }`}
    >
      <div className="bk-text-brand-muted">{position + 1}</div>
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
      <Cell value={row.reward} />
      <Cell value={row.rewardCreator} />
      <Cell value={row.rewardBooster} />
      <Cell value={row.rewardTrader} />
      <div className="bk-text-right bk-tabular-nums">{formatNumber(row.efficiency, 3)}x</div>
    </div>
  );
}

function Cell({ value }: { value: number }) {
  return <div className="bk-text-right bk-tabular-nums">{formatMoney(value)}</div>;
}
