"use client";

import { useEffect, useState, useTransition } from "react";
import type {
  MarketDetail,
  MarketSummary,
  RewardEvent,
  VaultEvent
} from "@/lib/queries";

const USD_SCALE = 1_000_000n;
const PROB_SCALE = 1_000_000n;

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type DashboardProps = {
  initialMarkets: MarketSummary[];
  initialMarketDetail: MarketDetail | null;
  initialBoosts: VaultEvent[];
  initialRewards: RewardEvent[];
};

export function Dashboard({ initialMarkets, initialMarketDetail, initialBoosts, initialRewards }: DashboardProps) {
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(
    initialMarketDetail?.market.marketId ?? initialMarkets[0]?.marketId ?? null
  );
  const [detail, setDetail] = useState<MarketDetail | null>(initialMarketDetail);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!selectedMarketId) return;
    if (detail && detail.market.marketId === selectedMarketId) return;

    startTransition(() => {
      fetcher(`/api/market/${selectedMarketId}`).then((data) => {
        if (!data || data.error) return;
        setDetail(data as MarketDetail);
      });
    });
  }, [selectedMarketId, detail]);

  const boosts = initialBoosts;
  const rewards = initialRewards;

  return (
    <div className="min-h-screen bg-surface text-ink p-6 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Context Edge</h1>
          <p className="text-sm text-ink/70">Prediction Markets on Base</p>
        </div>
        <span className="text-xs uppercase tracking-widest border border-ink/40 px-3 py-1 rounded">Base</span>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <MarketsPanel
            markets={initialMarkets}
            selected={selectedMarketId}
            onSelect={setSelectedMarketId}
          />
        </div>
        <div className="xl:col-span-1">
          <MarketDetailPanel marketId={selectedMarketId} detail={detail} loading={isPending} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <BoostsPanel events={boosts} />
        <RewardsPanel events={rewards} />
      </div>
    </div>
  );
}

type MarketsPanelProps = {
  markets: MarketSummary[];
  selected: string | null;
  onSelect: (marketId: string) => void;
};

function MarketsPanel({ markets, selected, onSelect }: MarketsPanelProps) {
  return (
    <section className="border border-ink/20 rounded-md bg-white/60">
      <header className="flex items-center justify-between px-4 py-3 border-b border-ink/10">
        <h2 className="font-semibold text-sm uppercase tracking-wide">Markets</h2>
        <span className="text-xs text-ink/60">{markets.length} tracked</span>
      </header>
      <div className="max-h-[480px] overflow-y-auto divide-y divide-ink/10">
        {markets.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink/60">No markets indexed yet.</p>
        ) : (
          markets.map((market) => {
            const topPrice = market.latestPrices.reduce((acc, value) => {
              const num = Number(BigInt(value) * 10000n / PROB_SCALE) / 100;
              return num > acc ? num : acc;
            }, 0);
            const flowDisplay = formatUsdcMicro(market.usdcFlow24h);
            const isSelected = market.marketId === selected;
            return (
              <button
                key={market.marketId}
                onClick={() => onSelect(market.marketId)}
                className={`w-full text-left px-4 py-3 transition ${
                  isSelected ? "bg-ink/10" : "hover:bg-ink/5"
                }`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-xs text-ink/80">{market.marketId}</p>
                    {market.outcomeNames.length > 0 ? (
                      <p className="text-sm font-semibold text-ink">
                        {market.outcomeNames.join(" / ")}
                      </p>
                    ) : (
                      <p className="text-sm text-ink/70">Unnamed market</p>
                    )}
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-semibold">Top Prob {topPrice.toFixed(2)}%</p>
                    <p className="text-ink/60">24h Flow {flowDisplay}</p>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

type MarketDetailPanelProps = {
  marketId: string | null;
  detail: MarketDetail | null;
  loading: boolean;
};

function MarketDetailPanel({ marketId, detail, loading }: MarketDetailPanelProps) {
  if (!marketId) {
    return (
      <section className="border border-ink/20 rounded-md bg-white/60 p-4 h-full">
        <p className="text-sm text-ink/70">Select a market to inspect details.</p>
      </section>
    );
  }

  if (loading || !detail) {
    return (
      <section className="border border-ink/20 rounded-md bg-white/60 p-4 h-full">
        <p className="text-sm text-ink/70">Loading market data…</p>
      </section>
    );
  }

  const { market, latestPrices, impact } = detail;

  return (
    <section className="border border-ink/20 rounded-md bg-white/60">
      <header className="px-4 py-3 border-b border-ink/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Market Detail</h2>
        <p className="font-mono text-xs text-ink/70 break-all">{market.marketId}</p>
      </header>
      <div className="px-4 py-3 space-y-3">
        <div>
          <h3 className="text-xs uppercase text-ink/60">Current Prices</h3>
          <div className="mt-2 space-y-1">
            {latestPrices.length === 0 ? (
              <p className="text-sm text-ink/60">No price snapshots yet.</p>
            ) : (
              latestPrices.map((price, idx) => {
                const pct = Number(BigInt(price) * 10000n / PROB_SCALE) / 100;
                const name = market.outcomeNames[idx] ?? `Outcome ${idx + 1}`;
                return (
                  <div key={idx} className="flex justify-between text-sm">
                    <span className="text-ink/80">{name}</span>
                    <span className="font-mono">{pct.toFixed(2)}%</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs uppercase text-ink/60">Cost To Move</h3>
          <div className="mt-2 border border-ink/10 rounded">
            <div className="grid grid-cols-2 text-xs font-semibold border-b border-ink/10">
              <span className="px-2 py-1">Clip (USDC)</span>
              <span className="px-2 py-1">Δ Prob (pp)</span>
            </div>
            {impact.length === 0 ? (
              <p className="text-sm text-ink/60 px-2 py-2">No impact pre-computed.</p>
            ) : (
              impact.map((row) => (
                <div key={`${row.usdcClip}-${row.ts}`} className="grid grid-cols-2 text-sm border-t border-ink/10">
                  <span className="px-2 py-1">{formatUsdcMicro(row.usdcClip)}</span>
                  <span className="px-2 py-1 font-mono">{row.deltaProb.toFixed(4)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

type BoostsPanelProps = {
  events: VaultEvent[];
};

function BoostsPanel({ events }: BoostsPanelProps) {
  return (
    <section className="border border-ink/20 rounded-md bg-white/60">
      <header className="px-4 py-3 border-b border-ink/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Boosts & Locks</h2>
      </header>
      <div className="max-h-72 overflow-y-auto divide-y divide-ink/10">
        {events.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">No vault activity captured yet.</p>
        ) : (
          events.map((event) => (
            <div key={`${event.marketId}-${event.ts}-${event.type}`} className="px-4 py-3 text-sm">
              <div className="flex justify-between text-xs text-ink/60">
                <span className="font-mono">{event.marketId}</span>
                <span>{formatTimestamp(event.ts)}</span>
              </div>
              <p className="mt-1 font-semibold capitalize">{event.type}</p>
              {event.type === "sponsored" ? (
                <SponsoredDetails payload={event.payload} />
              ) : (
                <p className="text-xs text-ink/70 mt-1">Amounts: {formatArray(event.payload.amounts)}</p>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

type RewardsPanelProps = {
  events: RewardEvent[];
};

function RewardsPanel({ events }: RewardsPanelProps) {
  return (
    <section className="border border-ink/20 rounded-md bg-white/60">
      <header className="px-4 py-3 border-b border-ink/10">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Rewards</h2>
      </header>
      <div className="max-h-72 overflow-y-auto divide-y divide-ink/10">
        {events.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink/60">No reward events yet.</p>
        ) : (
          events.map((event, idx) => (
            <div key={`${event.kind}-${event.epochId}-${idx}`} className="px-4 py-3 text-sm">
              <div className="flex justify-between text-xs text-ink/60">
                <span>Epoch {event.epochId}</span>
                <span>{formatTimestamp(event.ts)}</span>
              </div>
              <p className="mt-1 font-semibold capitalize">{event.kind}</p>
              {event.kind === "root" ? (
                <p className="text-xs font-mono text-ink/70 break-all">{event.root}</p>
              ) : (
                <div className="text-xs text-ink/70 mt-1 space-y-1">
                  <p>User: <span className="font-mono">{event.user}</span></p>
                  <p>Amount: {event.amount ? formatUsdcMicro(event.amount) : "0"}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

type SponsoredDetailsProps = {
  payload: Record<string, unknown>;
};

function SponsoredDetails({ payload }: SponsoredDetailsProps) {
  const userPaid = getBigInt(payload.userPaid);
  const subsidyUsed = getBigInt(payload.subsidyUsed);
  const actualCost = getBigInt(payload.actualCost);

  const total = userPaid + subsidyUsed;
  const subsidyRate = total > 0n ? Number((subsidyUsed * 10000n) / total) / 100 : 0;

  return (
    <div className="mt-1 text-xs text-ink/70 space-y-1">
      <p>User Paid: {formatUsdcBig(userPaid)}</p>
      <p>Subsidy Used: {formatUsdcBig(subsidyUsed)}</p>
      <p>Actual Cost: {formatUsdcBig(actualCost)}</p>
      <p>Subsidy Rate: {subsidyRate.toFixed(2)}%</p>
    </div>
  );
}

function formatArray(value: unknown): string {
  if (!Array.isArray(value)) return "-";
  return value
    .map((item) => {
      try {
        return formatUsdcBig(BigInt(item as string | number | bigint));
      } catch (error) {
        return String(item);
      }
    })
    .join(", ");
}

function formatUsdcBig(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / USD_SCALE;
  const remainder = abs % USD_SCALE;
  const decimalsBase = remainder / 10_000n;
  let decimalStr = "";
  if (remainder !== 0n && remainder < USD_SCALE / 100n) {
    return `${sign}$<0.01`;
  }
  const decimals = Number(decimalsBase);
  if (decimals > 0) {
    decimalStr = `.${decimals.toString().padStart(2, "0")}`;
  }
  const wholeStr = formatInteger(whole);
  return `${sign}$${wholeStr}${decimalStr}`;
}

function formatUsdcMicro(value: string): string {
  try {
    return formatUsdcBig(BigInt(value));
  } catch (error) {
    return value;
  }
}

function getBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "number") return BigInt(Math.trunc(value));
  return 0n;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleString(undefined, {
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatInteger(value: bigint): string {
  const raw = value.toString();
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
