import type { KPI } from "@/lib/kpi";
import { usd } from "@/lib/num";

export function KPIGrid({ items }: { items: KPI[] }) {
  if (!items.length) return null;
  return (
    <section className="bk-grid bk-grid-cols-1 sm:bk-grid-cols-2 bk-gap-3">
      {items.map((item) => (
        <article
          key={item.key}
          className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-4 bk-space-y-2"
        >
          <p className="bk-text-2xs bk-text-brand-muted">{item.label}</p>
          <p className="bk-text-xl bk-font-medium bk-tabular-nums bk-text-brand-text">{usd(item.value)}</p>
        </article>
      ))}
    </section>
  );
}
