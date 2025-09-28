'use client';

import { useEffect, useState, useTransition } from "react";
import type { SlateItem as SlateEntry } from "@/lib/db";
import { formatHoursUntil, formatMoney, formatNumber } from "@/lib/fmt";
import { Sparkline } from "@/components/Sparkline";

export function LiveSlate({ initial }: { initial: SlateEntry[] }) {
  const [entries, setEntries] = useState(initial);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const refresh = () => {
      startTransition(() => {
        fetch("/api/live-slate")
          .then((res) => res.json())
          .then((data) => {
            if (Array.isArray(data?.rows)) {
              setEntries(data.rows as SlateEntry[]);
            }
          })
          .catch(() => {});
      });
    };

    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h2 className="bk-text-sm bk-text-brand-muted">Live slate</h2>
        {isPending && <span className="bk-text-xs bk-text-brand-muted">Refreshing…</span>}
      </header>
      <div className="bk-grid bk-grid-cols-1 lg:bk-grid-cols-2 bk-gap-3">
        {entries.map((item) => (
          <SlateCard key={item.marketId} item={item} />
        ))}
        {entries.length === 0 && <p className="bk-text-sm bk-text-brand-muted">No markets yet.</p>}
      </div>
    </section>
  );
}

function SlateCard({ item }: { item: SlateEntry }) {
  const priceValues = item.priceSeries.map((point) => point.prices[0] ?? 0);
  const tvlValues = item.tvlSeries.map((point) => point.tvl);
  const outcomeList = item.outcomes.slice(0, 3);
  const shortAddress = (addr: string | null | undefined) => {
    if (!addr) return "";
    return addr.length <= 10 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  return (
    <div className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <div className="bk-flex bk-items-start bk-justify-between">
        <div className="bk-space-y-1">
          <a
            href={`https://context.markets/markets/${item.marketId}`}
            target="_blank"
            rel="noreferrer"
            className="bk-text-brand-text bk-text-sm hover:bk-text-brand-blue"
          >
            {item.title}
          </a>
          <div className="bk-flex bk-flex-wrap bk-gap-2 bk-text-2xs bk-text-brand-muted">
            {item.questionId && <span>QID {shortAddress(item.questionId)}</span>}
            {item.oracle && <span>Oracle {shortAddress(item.oracle)}</span>}
            {item.surplusRecipient && <span>Surplus {shortAddress(item.surplusRecipient)}</span>}
          </div>
          <p className="bk-text-xs bk-text-brand-muted">{formatHoursUntil(item.cutoffTs)}</p>
        </div>
        <div className="bk-text-right bk-text-xs bk-text-brand-muted">
          Edge
          <div className="bk-text-lg bk-text-brand-blue bk-tabular-nums">{formatNumber(item.edgeScore, 2)}</div>
          <div className="bk-flex bk-flex-col bk-gap-0.5 bk-text-2xs">
            <span>Boost {formatNumber(item.edgeBreakdown.boost, 2)}</span>
            <span>Volume {formatNumber(item.edgeBreakdown.volume, 2)}</span>
            <span>Traders {formatNumber(item.edgeBreakdown.traders, 2)}</span>
          </div>
        </div>
      </div>

      {outcomeList.length > 0 && (
        <div className="bk-flex bk-flex-wrap bk-gap-1">
          {outcomeList.map((label, index) => (
            <span key={label} className="bk-rounded-full bk-bg-brand-surface bk-text-2xs bk-text-brand-muted bk-px-2 bk-py-0.5">
              {index === 0 ? "Yes" : index === 1 ? "No" : index + 1}: {label}
            </span>
          ))}
        </div>
      )}

      <div className="bk-grid sm:bk-grid-cols-2 bk-gap-3">
        <div>
          <div className="bk-flex bk-items-center bk-justify-between bk-text-2xs bk-text-brand-muted">
            <span>Price</span>
            {item.lastPrices.length > 0 && <span>{formatNumber(item.lastPrices[0] ?? 0, 3)}</span>}
          </div>
          <Sparkline values={priceValues} height={36} />
        </div>
        <div>
          <div className="bk-flex bk-items-center bk-justify-between bk-text-2xs bk-text-brand-muted">
            <span>TVL</span>
            <span>{formatMoney(item.tvl)}</span>
          </div>
          <Sparkline values={tvlValues} height={36} strokeClass="bk-stroke-brand-orange" fillClass="bk-fill-brand-orange/20" />
        </div>
      </div>

      <div className="bk-flex bk-flex-wrap bk-gap-3 bk-text-xs bk-text-brand-muted">
        <span>Boost {formatMoney(item.boostTotal)}</span>
        <span>Vol 24h {formatMoney(item.volume24h)}</span>
        <span>Traders 24h {item.uniqueTraders24h}</span>
        {item.costToMove && (
          <span>
            Δ1pt ≈ {item.costToMove.costPerPoint != null ? formatMoney(item.costToMove.costPerPoint) : formatMoney(item.costToMove.usdc)}
          </span>
        )}
      </div>

      {item.heuristics && <RiskChips heuristics={item.heuristics} />}

      <div className="bk-flex bk-gap-2">
        <a
          className="bk-rounded-full bk-bg-brand-blue bk-text-black bk-text-xs bk-font-medium bk-px-3 bk-py-1.5"
          href={`https://context.markets/markets/${item.marketId}?action=boost`}
          target="_blank"
          rel="noreferrer"
        >
          Boost
        </a>
        <a
          className="bk-rounded-full bk-border bk-border-brand-ring/60 bk-text-brand-muted hover:bk-text-brand-text bk-text-xs bk-font-medium bk-px-3 bk-py-1.5"
          href={`https://context.markets/markets/${item.marketId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open
        </a>
      </div>
    </div>
  );
}

type RiskSummary = NonNullable<SlateEntry["heuristics"]>;

function chipVariant(score: number): "good" | "warn" | "bad" {
  if (score >= 0.75) return "good";
  if (score >= 0.5) return "warn";
  return "bad";
}

const CHIP_STYLES: Record<"good" | "warn" | "bad", string> = {
  good: "bk-bg-success/20 bk-text-success",
  warn: "bk-bg-warning/20 bk-text-warning",
  bad: "bk-bg-danger/20 bk-text-danger"
};

function RiskChips({ heuristics }: { heuristics: RiskSummary }) {
  const clarityVariant = chipVariant(heuristics.clarity);
  const sourceVariant = heuristics.sourceCount === 0 ? "bad" : heuristics.sourceDomains >= 2 ? "good" : "warn";
  const settlementVariant = chipVariant(heuristics.settlementScore);

  const clarityLabel = heuristics.clarity >= 0.85 ? "High" : heuristics.clarity >= 0.6 ? "Moderate" : "Low";
  const parityLabel = heuristics.sourceCount === 0 ? "No sources" : heuristics.sourceDomains >= 2 ? "Multi-source" : "Single source";
  const settlementLabel = heuristics.settlementScore >= 0.75 ? "Stable" : heuristics.settlementScore >= 0.55 ? "Watch" : "Risk";

  return (
    <div className="bk-flex bk-flex-wrap bk-gap-2">
      <span
        className={`bk-inline-flex bk-items-center bk-gap-1 bk-rounded-full bk-border bk-border-brand-ring/30 bk-px-2.5 bk-py-1 bk-text-2xs ${CHIP_STYLES[clarityVariant]}`}
        title={
          heuristics.ambiguousTerms.length || heuristics.vagueCount
            ? `Ambiguous terms: ${heuristics.ambiguousTerms.join(", ")} • Vague phrases: ${heuristics.vagueCount}`
            : "Clear rule text"
        }
      >
        <span>Clarity</span>
        <span>{clarityLabel}</span>
      </span>
      <span
        className={`bk-inline-flex bk-items-center bk-gap-1 bk-rounded-full bk-border bk-border-brand-ring/30 bk-px-2.5 bk-py-1 bk-text-2xs ${CHIP_STYLES[sourceVariant]}`}
        title={`Sources: ${heuristics.sourceCount} • Domains: ${heuristics.sourceDomains}`}
      >
        <span>Sources</span>
        <span>{parityLabel}</span>
      </span>
      <span
        className={`bk-inline-flex bk-items-center bk-gap-1 bk-rounded-full bk-border bk-border-brand-ring/30 bk-px-2.5 bk-py-1 bk-text-2xs ${CHIP_STYLES[settlementVariant]}`}
        title={heuristics.warnings.length ? heuristics.warnings.join(" · ") : "Low settlement risk"}
      >
        <span>Settlement</span>
        <span>{settlementLabel}</span>
      </span>
    </div>
  );
}
