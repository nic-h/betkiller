import type { KPI } from "@/lib/db";
import { formatMoney, formatNumber } from "@/lib/fmt";
import { formatRangeLabel } from "@/lib/range";

function formatValue(item: KPI): string {
  if (item.format === "number") {
    return formatNumber(item.value, 1);
  }
  return formatMoney(item.value);
}

function formatChange(item: KPI): string {
  if (item.format === "number") {
    return formatNumber(item.change ?? 0, 1);
  }
  return formatMoney(item.change ?? 0);
}

export function KPIGrid({ items }: { items: KPI[] }) {
  return (
    <section className="bk-grid bk-grid-cols-1 md:bk-grid-cols-2 xl:bk-grid-cols-4 bk-gap-3">
      {items.map((item) => (
        <div
          key={item.key}
          className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-4 bk-space-y-2"
        >
          <div className="bk-flex bk-items-center bk-justify-between">
            <p className="bk-text-xs bk-text-brand-muted">{item.label}</p>
            <span className="bk-rounded-full bk-bg-brand-ring/40 bk-px-2 bk-py-0.5 bk-text-[11px] bk-text-brand-muted">
              {formatRangeLabel(item.range)}
            </span>
          </div>
          <p className="bk-text-2xl bk-tabular-nums bk-text-brand-text">{formatValue(item)}</p>
          {typeof item.change === "number" && (
            <p
              className={`bk-text-xs bk-tabular-nums ${
                item.change >= 0 ? "bk-text-brand-blue" : "bk-text-brand-orange"
              }`}
            >
              {item.change >= 0 ? "+" : ""}{formatChange(item)}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
