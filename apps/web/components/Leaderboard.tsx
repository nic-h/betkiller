'use client';

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { LeaderboardBucket, LeaderboardRow } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/fmt";
import { useRange } from "@/components/RangeProvider";
import { RANGE_OPTIONS, formatRangeLabel } from "@/lib/range";

const RANGES = RANGE_OPTIONS;
const BUCKETS: { key: LeaderboardBucket; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "creator", label: "Creator" },
  { key: "booster", label: "Booster" },
  { key: "trader", label: "Trader" },
  { key: "efficiency", label: "Efficiency" }
];

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
        d="M8 2H1l8.261 11.014L1.45 22h2.65l6.388-7.349L16 22h7l-8.608-11.478L21.8 2h-2.65L13.164 8.886 8 2Zm9 18L5 4h2l12 16h-2Z"
      />
    </svg>
  );
}

export function Leaderboard({
  dense = false,
  initialRows,
  initialBucket
}: {
  dense?: boolean;
  initialRows: LeaderboardRow[];
  initialBucket: LeaderboardBucket;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { range, setRange } = useRange();
  const [rows, setRows] = useState(initialRows);
  const allowedBuckets = BUCKETS.map((entry) => entry.key);
  const safeInitialBucket = allowedBuckets.includes(initialBucket) ? initialBucket : "total";
  const [bucket, setBucket] = useState<LeaderboardBucket>(safeInitialBucket);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    if (allowedBuckets.includes(initialBucket)) {
      setBucket(initialBucket);
    }
  }, [initialBucket]);

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
    const rangeLabel = formatRangeLabel(range);
    return `${bucketLabel} — ${rangeLabel}`;
  }, [bucket, range]);

  const handleBucketChange = (next: LeaderboardBucket) => {
    setBucket(next);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "total") {
      params.delete("by");
    } else {
      params.set("by", next);
    }
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    router.replace(target as any, { scroll: false });
  };

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
          {RANGES.map((value) => (
            <button
              key={value}
              className={`bk-rounded-full bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
                range === value ? "bk-bg-brand-blue bk-text-black" : "bk-bg-brand-surface bk-text-brand-muted hover:bk-text-brand-text"
              }`}
              onClick={() => setRange(value)}
            >
              {formatRangeLabel(value)}
            </button>
          ))}
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
              onClick={() => handleBucketChange(option.key)}
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
              <Row key={row.addr} position={index} row={row} highlight={index === 0} pad={pad} dense={dense} />
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
  pad,
  dense
}: {
  position: number;
  row: LeaderboardRow;
  highlight: boolean;
  pad: string;
  dense: boolean;
}) {
  const rowIsHighlighted = highlight && !dense;
  const stickyBg = rowIsHighlighted ? "bk-bg-brand-blue/15" : "bk-bg-brand-panel";
  const handle = row.xHandle;
  const showHandle = Boolean(handle);
  const detailLine = dense
    ? `Markets ${row.marketsTouched} • Last claim ${formatTimeAgo(row.recentRewardTs)}`
    : `Markets ${row.marketsTouched} • Last claim ${formatTimeAgo(row.recentRewardTs)} • Active ${formatTimeAgo(row.lastSeen)}`;
  return (
    <tr className={`${rowIsHighlighted ? "bk-bg-brand-blue/10" : ""} hover:bk-bg-brand-surface/60`}>
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
          {showHandle && (
            <a
              href={`https://twitter.com/${handle}`}
              target="_blank"
              rel="noreferrer"
              className="bk-inline-flex bk-items-center bk-gap-1 bk-text-brand-muted bk-text-xs hover:bk-text-brand-text"
            >
              <XIcon />
              <span>@{handle}</span>
            </a>
          )}
        </div>
        <div className="bk-text-2xs bk-text-brand-muted bk-mt-1">{detailLine}</div>
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
