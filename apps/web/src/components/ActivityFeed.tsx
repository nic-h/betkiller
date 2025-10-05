import Link from "next/link";
import { AddressOrName } from "@/components/AddressOrName";

export type ActivityEvent = {
  ts: number;
  kind: string;
  market?: string | null;
  user: string;
  amount?: string | null;
};

type ActivityFeedProps = {
  events: ActivityEvent[];
  limit?: number;
};

const KIND_LABEL: Record<string, string> = {
  DEPOSIT: "Deposit",
  WITHDRAW: "Withdraw",
  BUY: "Buy",
  SELL: "Sell",
  CLAIM: "Claim",
  REFUND: "Refund",
  BOOST_ADD: "Boost Added",
  BOOST_REMOVE: "Boost Removed",
  REWARD: "Reward"
};

function relativeTime(ts: number): string {
  if (!ts) return "";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

export function ActivityFeed({ events, limit = 30 }: ActivityFeedProps) {
  const rows = events.slice(0, limit);
  return (
    <section className="bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h3 className="bk-text-sm bk-font-medium bk-text-slate-300">Activity</h3>
        <span className="bk-text-xs bk-text-slate-500">Last {rows.length} events</span>
      </header>
      <div className="bk-divide-y bk-divide-slate-800 bk-rounded-xl bk-border bk-border-slate-800 bk-bg-slate-900/40">
        {rows.length === 0 ? (
          <div className="bk-px-4 bk-py-6 bk-text-center bk-text-sm bk-text-slate-500">No activity in range.</div>
        ) : (
          rows.map((event) => (
            <div key={`${event.ts}-${event.kind}-${event.user}-${event.market ?? ""}`} className="bk-flex bk-items-center bk-justify-between bk-gap-4 bk-px-4 bk-py-3">
              <div className="bk-w-20 bk-text-xs bk-uppercase bk-tracking-wide bk-text-slate-500">{relativeTime(event.ts)}</div>
              <div className="bk-flex-1 bk-text-sm bk-text-slate-200">
                <span className="bk-font-medium">{KIND_LABEL[event.kind] ?? event.kind}</span>
                {event.market ? (
                  <span className="bk-ml-2 bk-text-slate-400">
                    <Link href={`https://context.build/markets/${event.market}`} target="_blank" rel="noopener noreferrer">
                      {event.market.slice(0, 6)}…{event.market.slice(-4)}
                    </Link>
                  </span>
                ) : null}
              </div>
              <AddressOrName address={event.user} className="bk-text-right" />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
