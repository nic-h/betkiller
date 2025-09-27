import type { KPI } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

export function KPIGrid({ items }: { items: KPI[] }) {
  return (
    <section className="bk-grid bk-grid-cols-1 md:bk-grid-cols-2 xl:bk-grid-cols-4 bk-gap-3">
      {items.map((item) => (
        <div key={item.label} className="bk-rounded-lg bk-bg-surface bk-p-4 bk-ring-1 bk-ring-border bk-shadow-sm">
          <p className="bk-text-xs bk-uppercase bk-tracking-widest bk-text-muted">{item.label}</p>
          <p className="bk-mt-3 bk-text-2xl bk-tabular-nums">{formatMoney(item.value)}</p>
          {typeof item.change === "number" && (
            <p className={`bk-mt-1 bk-text-xs bk-tabular-nums ${item.change >= 0 ? "bk-text-success" : "bk-text-danger"}`}>
              {item.change >= 0 ? "+" : ""}{formatMoney(item.change)}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}
