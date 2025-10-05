import { useState } from "react";
import useSWR from "swr";
import { AddressOrName } from "@/components/AddressOrName";
import { ActivityFeed } from "@/components/ActivityFeed";
import { EventLog } from "@/components/EventLog";
import { StatCard } from "@/components/StatCard";
import { NearResolutionList } from "@/components/NearResolutionList";
import type { TimeRangeKey } from "@/lib/timeRange";
import type { NearResolutionMarket } from "@/lib/nearResolution";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return response.json();
};

type WalletStatsResponse = {
  estimated_portfolio_value: string;
  cash: string;
  claims: string;
  boosts: string;
  all_time: {
    win_loss: string;
    total_buys: string;
    rewards: string;
    winnings: string;
  };
};

type ActivityResponse = {
  events: Parameters<typeof ActivityFeed>[0]["events"];
};

type LedgerResponse = {
  events: Parameters<typeof EventLog>[0]["events"];
};

const TIME_RANGE_OPTIONS: TimeRangeKey[] = ["24h", "7d", "30d"];

export default function DashboardPage() {
  const [walletInput, setWalletInput] = useState("");
  const [activeWallet, setActiveWallet] = useState<string | null>(null);
  const [range, setRange] = useState<TimeRangeKey>("24h");

  const normalizedWallet = activeWallet?.toLowerCase() ?? null;

  const stats = useSWR<WalletStatsResponse | null>(
    normalizedWallet ? `/api/wallet-stats/${normalizedWallet}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 0
    }
  );

  const activity = useSWR<ActivityResponse | null>(
    normalizedWallet ? `/api/wallet-activity/${normalizedWallet}?range=${range}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 0
    }
  );

  const ledger = useSWR<LedgerResponse | null>(
    normalizedWallet ? `/api/wallet-ledger/${normalizedWallet}?limit=100` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 0
    }
  );

  const nearResolution = useSWR<{ markets: NearResolutionMarket[] }>(
    "/api/near-resolution?limit=6",
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 60_000
    }
  );

  const health = useSWR<{ partial: boolean; notes: string[] }>(
    "/api/health",
    fetcher,
    {
      revalidateOnFocus: false,
      refreshInterval: 60_000
    }
  );

  function submitWallet(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setActiveWallet(trimmed.toLowerCase());
  }

  const walletHeader = normalizedWallet ? (
    <div className="bk-flex bk-items-center bk-gap-2 bk-text-sm">
      <span className="bk-text-slate-500">Wallet:</span>
      <AddressOrName address={normalizedWallet} showAvatar />
    </div>
  ) : (
    <span className="bk-text-sm bk-text-slate-500">Enter a wallet to load stats.</span>
  );

  const statsData = stats.data ?? null;

  const displayValue = (value?: string | null) => {
    if (!value) return "—";
    return value;
  };

  return (
    <main className="bk-min-h-screen bk-bg-slate-950 bk-pb-12 bk-text-slate-100">
      <div className="bk-mx-auto bk-flex bk-max-w-6xl bk-flex-col bk-gap-8 bk-px-4 bk-py-10">
        <header className="bk-space-y-4">
          <div>
            <h1 className="bk-text-3xl bk-font-semibold">Context Wallet Dash</h1>
            <p className="bk-text-sm bk-text-slate-400">
              Derived directly from Base on-chain logs. No synthetic data, no guesswork.
            </p>
            {health.data?.partial ? (
              <div className="bk-mt-2 bk-rounded-md bk-border bk-border-amber-500/40 bk-bg-amber-950/40 bk-px-3 bk-py-2 bk-text-xs bk-text-amber-200">
                Data is partial while the indexer catches up.
                {health.data.notes?.length ? (
                  <ul className="bk-mt-1 bk-space-y-1">
                    {health.data.notes.map((note) => (
                      <li key={note}>• {note}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitWallet(walletInput);
              }}
              className="bk-flex bk-gap-2"
            >
              <input
                className="bk-rounded-lg bk-border bk-border-slate-700 bk-bg-slate-900 bk-px-3 bk-py-2 bk-text-sm bk-text-slate-100 bk-outline-none focus:bk-border-slate-400"
                placeholder="0x..."
                value={walletInput}
                onChange={(event) => setWalletInput(event.target.value)}
              />
              <button
                type="submit"
                className="bk-rounded-lg bk-bg-slate-700 bk-px-3 bk-py-2 bk-text-sm bk-font-medium bk-text-white hover:bk-bg-slate-600"
              >
                Load
              </button>
            </form>
            <div className="bk-flex bk-items-center bk-gap-2">
              {TIME_RANGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  className={`bk-rounded-full bk-border bk-px-3 bk-py-1 bk-text-xs bk-uppercase bk-tracking-wide ${
                    range === option ? "bk-border-slate-400 bk-bg-slate-700" : "bk-border-slate-800 bk-bg-slate-900"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
          {walletHeader}
        </header>

        <section className="bk-grid bk-grid-cols-1 bk-gap-4 md:bk-grid-cols-4">
          <StatCard label="Estimated Portfolio Value" value={displayValue(statsData?.estimated_portfolio_value)} />
          <StatCard label="Cash" value={displayValue(statsData?.cash)} />
          <StatCard label="Claims" value={displayValue(statsData?.claims)} />
          <StatCard label="Boosts" value={displayValue(statsData?.boosts)} />
        </section>

        <section className="bk-grid bk-grid-cols-1 bk-gap-4 md:bk-grid-cols-4">
          <StatCard label="Win / Loss" value={displayValue(statsData?.all_time?.win_loss)} />
          <StatCard label="Total Buys" value={displayValue(statsData?.all_time?.total_buys)} />
          <StatCard label="Rewards" value={displayValue(statsData?.all_time?.rewards)} />
          <StatCard label="Winnings" value={displayValue(statsData?.all_time?.winnings)} />
        </section>

        <NearResolutionList markets={nearResolution.data?.markets ?? []} />

        <section className="bk-grid bk-grid-cols-1 bk-gap-6 lg:bk-grid-cols-2">
          <ActivityFeed events={activity.data?.events ?? []} />
          <EventLog events={ledger.data?.events ?? []} />
        </section>
      </div>
    </main>
  );
}
