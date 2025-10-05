import type { ActivityEvent } from "@/lib/db";
import { usd } from "@/lib/num";
import { shortAddr } from "@/lib/identity";

export function ActivityList({ events }: { events: ActivityEvent[] }) {
  if (!events.length) {
    return (
      <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5">
        <h2 className="bk-text-sm bk-font-medium bk-text-brand-text">Recent activity</h2>
        <p className="bk-mt-2 bk-text-xs bk-text-brand-muted">No boosts, trades, or rewards in this range.</p>
      </section>
    );
  }

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <h2 className="bk-text-sm bk-font-medium bk-text-brand-text">Recent activity</h2>
      <ul className="bk-space-y-3">
        {events.map((event) => (
          <li key={`${event.type}-${event.ts}-${event.address ?? "anon"}`} className="bk-flex bk-items-start bk-justify-between bk-gap-4">
            <div className="bk-space-y-1">
              <p className="bk-text-xs bk-font-medium bk-text-brand-text">{formatLabel(event)}</p>
              <p className="bk-text-2xs bk-text-brand-muted">
                {event.name ?? shortAddr(event.address)} · {event.marketId ?? "–"}
              </p>
            </div>
            <div className="bk-text-right bk-text-2xs bk-text-brand-muted">
              <p>{formatTime(event.ts)}</p>
              {event.amount ? <p>{usd(event.amount)}</p> : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatLabel(event: ActivityEvent): string {
  switch (event.type) {
    case "reward":
      return event.description;
    case "boost":
      return event.description;
    case "trade":
      return event.description;
    default:
      return event.description;
  }
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
