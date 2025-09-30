'use client';

import { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { MarketTableRow } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";
import { useDensity } from "@/components/DensityProvider";
import { Sparkline } from "@/components/Sparkline";

export function MarketsTable({ rows }: { rows: MarketTableRow[] }) {
  const { density } = useDensity();
  const [expanded, setExpanded] = useState<string | null>(null);
  const parentRef = useRef<HTMLDivElement | null>(null);

  const rowHeight = density === "compact" ? 52 : 64;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const handleToggle = (id: string) => {
    setExpanded((value) => (value === id ? null : id));
  };

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h2 className="bk-text-sm bk-text-brand-muted">Markets</h2>
        <span className="bk-text-2xs bk-text-brand-muted">{rows.length} markets</span>
      </header>
      <div className="bk-overflow-hidden bk-rounded-2xl bk-border bk-border-brand-ring/40">
        <table className="bk-w-full bk-text-xs lg:bk-text-sm">
          <thead className="bk-bg-brand-surface">
            <tr className="bk-text-brand-muted">
              <th className="bk-text-left bk-font-normal bk-px-3 bk-py-2">Market</th>
              <th className="bk-text-right bk-font-normal bk-px-3 bk-py-2">Price (Yes)</th>
              <th className="bk-text-right bk-font-normal bk-px-3 bk-py-2">Liquidity</th>
              <th className="bk-text-right bk-font-normal bk-px-3 bk-py-2">Spread</th>
              <th className="bk-text-right bk-font-normal bk-px-3 bk-py-2">Cost to move</th>
              <th className="bk-text-right bk-font-normal bk-px-3 bk-py-2">Cutoff</th>
              <th className="bk-text-right bk-font-normal bk-px-3 bk-py-2">Sparkline</th>
              <th className="bk-w-12" />
            </tr>
          </thead>
        </table>
        <div ref={parentRef} className="bk-max-h-[520px] bk-overflow-y-auto">
          <div style={{ height: totalSize, position: "relative" }}>
            {virtualItems.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const isExpanded = expanded === row.marketId;
              return (
                <div
                  key={row.marketId}
                  data-index={virtualRow.index}
                  ref={(node) => virtualizer.measureElement(node)}
                  className="bk-absolute bk-left-0 bk-right-0"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <table className="bk-w-full bk-text-xs lg:bk-text-sm">
                    <tbody>
                      <tr className="bk-border-t bk-border-brand-ring/30 hover:bk-bg-brand-surface/60">
                        <td className="bk-px-3 bk-py-2">
                          <div className="bk-flex bk-flex-col">
                            <a
                              href={`https://context.markets/markets/${row.marketId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="bk-text-sm bk-text-brand-blue hover:bk-text-brand-text"
                            >
                              {row.title}
                            </a>
                            {row.category && <span className="bk-text-2xs bk-text-brand-muted">{row.category}</span>}
                          </div>
                        </td>
                        <td className="bk-text-right bk-tabular-nums bk-px-3 bk-py-2">{formatPercent(row.priceYes)}</td>
                        <td className="bk-text-right bk-tabular-nums bk-px-3 bk-py-2">{formatMoney(row.tvl)}</td>
                        <td className="bk-text-right bk-tabular-nums bk-px-3 bk-py-2">{formatPercent(row.spread)}</td>
                        <td className="bk-text-right bk-tabular-nums bk-px-3 bk-py-2">
                          {row.costToMove != null ? formatMoney(row.costToMove) : "–"}
                        </td>
                        <td className="bk-text-right bk-tabular-nums bk-px-3 bk-py-2">{formatHoursUntil(row.cutoffTs)}</td>
                        <td className="bk-px-3 bk-py-2">
                          <Sparkline values={row.sparkline} height={density === "compact" ? 32 : 40} />
                        </td>
                        <td className="bk-px-3 bk-py-2 bk-text-right">
                          <button
                            type="button"
                            onClick={() => handleToggle(row.marketId)}
                            className="bk-inline-flex bk-items-center bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-2 bk-py-1 bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
                          >
                            {isExpanded ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bk-bg-brand-surface/60">
                          <td colSpan={8} className="bk-px-3 bk-py-3">
                            <div className="bk-flex bk-flex-wrap bk-gap-4 bk-text-2xs bk-text-brand-muted">
                              <span>Boost {formatMoney(row.boostTotal)}</span>
                              <span>Volume {formatMoney(row.volumeRange)}</span>
                              <a
                                href={`https://context.markets/markets/${row.marketId}`}
                                target="_blank"
                                rel="noreferrer"
                                className="bk-text-brand-blue hover:bk-text-brand-text"
                              >
                                View market →
                              </a>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function formatPercent(value: number | null): string {
  if (value == null) return "–";
  return `${(value * 100).toFixed(1)}%`;
}

function formatHoursUntil(timestamp: number) {
  const diff = Math.max(0, timestamp * 1000 - Date.now());
  const hours = diff / 3_600_000;
  if (hours >= 24) {
    return `${Math.round(hours / 24)}d`;
  }
  return `${Math.max(1, Math.round(hours))}h`;
}
