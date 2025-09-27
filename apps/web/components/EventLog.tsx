import type { EventLogEntry } from "@/lib/db";
import { formatDateShort } from "@/lib/fmt";

export function EventLog({ events, errors }: { events: EventLogEntry[]; errors: string[] }) {
  return (
    <footer className="bk-grid bk-grid-cols-1 lg:bk-grid-cols-2 bk-gap-4 bk-rounded-lg bk-bg-surface bk-ring-1 bk-ring-border bk-shadow-sm bk-p-4">
      <div>
        <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-muted">Recent Events</h2>
        <div className="bk-mt-3 bk-space-y-2 bk-text-xs">
          {events.map((event, idx) => (
            <div key={idx} className="bk-flex bk-justify-between bk-text-muted">
              <span>{event.description}</span>
              <span>{formatDateShort(event.ts)}</span>
            </div>
          ))}
          {events.length === 0 && <p className="bk-text-muted">No events yet.</p>}
        </div>
      </div>
      <div>
        <h2 className="bk-text-sm bk-uppercase bk-tracking-widest bk-text-muted">Errors</h2>
        <div className="bk-mt-3 bk-space-y-2 bk-text-xs">
          {errors.map((error, idx) => (
            <div key={idx} className="bk-text-danger">{error}</div>
          ))}
          {errors.length === 0 && <p className="bk-text-muted">All clear.</p>}
        </div>
      </div>
    </footer>
  );
}
