import { AddressOrName } from "@/components/AddressOrName";
import { formatFP } from "@/lib/fp";

export type NormalizedEvent = {
  address: string;
  user: string;
  market: string | null;
  kind: string;
  side: string | null;
  amount_fp: string | null;
  shares_fp: string | null;
  fee_fp: string | null;
  ts: number;
  txhash: string;
  blk: number;
  logi: number;
};

type EventLogProps = {
  events: NormalizedEvent[];
  limit?: number;
};

function shortHash(value: string): string {
  if (!value.startsWith("0x")) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function EventLog({ events, limit = 30 }: EventLogProps) {
  const rows = events.slice(0, limit);
  return (
    <section className="bk-space-y-3">
      <header className="bk-flex bk-items-center bk-justify-between">
        <h3 className="bk-text-sm bk-font-medium bk-text-slate-300">Event Log</h3>
        <span className="bk-text-xs bk-text-slate-500">Last {rows.length} rows</span>
      </header>
      <div className="bk-overflow-hidden bk-rounded-xl bk-border bk-border-slate-800 bk-bg-slate-950/70">
        <table className="bk-w-full bk-table-auto bk-text-left bk-text-xs bk-font-mono bk-text-slate-300">
          <thead className="bk-bg-slate-900/80 bk-text-slate-400">
            <tr>
              <th className="bk-px-3 bk-py-2">Time</th>
              <th className="bk-px-3 bk-py-2">Kind</th>
              <th className="bk-px-3 bk-py-2">Market</th>
              <th className="bk-px-3 bk-py-2">Side</th>
              <th className="bk-px-3 bk-py-2">Amount</th>
              <th className="bk-px-3 bk-py-2">Shares</th>
              <th className="bk-px-3 bk-py-2">User</th>
              <th className="bk-px-3 bk-py-2">Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="bk-px-3 bk-py-6 bk-text-center bk-text-slate-500" colSpan={8}>
                  No events in range.
                </td>
              </tr>
            ) : (
              rows.map((event) => (
                <tr key={`${event.txhash}-${event.logi}`} className="bk-border-t bk-border-slate-900/60">
                  <td className="bk-px-3 bk-py-2">{new Date(event.ts * 1000).toLocaleString()}</td>
                  <td className="bk-px-3 bk-py-2">{event.kind}</td>
                  <td className="bk-px-3 bk-py-2">{event.market ? shortHash(event.market) : "-"}</td>
                  <td className="bk-px-3 bk-py-2">{event.side ?? "-"}</td>
                  <td className="bk-px-3 bk-py-2">{formatFP(event.amount_fp ? BigInt(event.amount_fp) : null)}</td>
                  <td className="bk-px-3 bk-py-2">{formatFP(event.shares_fp ? BigInt(event.shares_fp) : null)}</td>
                  <td className="bk-px-3 bk-py-2">
                    <AddressOrName address={event.user} />
                  </td>
                  <td className="bk-px-3 bk-py-2">
                    <a
                      href={`https://basescan.org/tx/${event.txhash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bk-text-sky-300"
                    >
                      {shortHash(event.txhash)}
                    </a>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
