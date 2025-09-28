import type { EventLogEntry } from "@/lib/db";
import { formatDateShort } from "@/lib/fmt";

export function EventLog({ events, errors }: { events: EventLogEntry[]; errors: string[] }) {
  return (
    <footer className="bk-grid bk-grid-cols-1 lg:bk-grid-cols-2 bk-gap-6 bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-6">
      <div className="bk-space-y-3">
        <h2 className="bk-text-sm bk-text-brand-muted">Recent events</h2>
        <div className="bk-space-y-2 bk-text-xs">
          {events.map((event, idx) => (
            <div key={idx} className="bk-flex bk-justify-between bk-text-brand-muted">
              <span>{event.description}</span>
              <span>{formatDateShort(event.ts)}</span>
            </div>
          ))}
          {events.length === 0 && <p className="bk-text-brand-muted">No events yet.</p>}
        </div>
      </div>
      <div className="bk-space-y-3">
        <h2 className="bk-text-sm bk-text-brand-muted">Errors</h2>
        <div className="bk-space-y-2 bk-text-xs">
          {errors.map((error, idx) => (
            <div key={idx} className="bk-text-brand-orange">{error}</div>
          ))}
          {errors.length === 0 && <p className="bk-text-brand-muted">All clear.</p>}
        </div>
      </div>
    </footer>
  );
}
