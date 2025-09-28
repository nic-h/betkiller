'use client';

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/fmt";

type RewardTotals = {
  claimable: string;
  claimed: string;
  pending: string;
};

type RewardEpoch = {
  epochId: number;
  status: "claimed" | "pending";
  claimed: string;
  txHash: string | null;
  claimable: string;
};

type RewardSummaryResponse = {
  address: string;
  epochs: RewardEpoch[];
  totals: RewardTotals;
  lastRootEpoch: number | null;
  syncedAt: number;
  providerSyncedAt?: number | null;
};

function microsToNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  try {
    return Number(BigInt(value)) / 1_000_000;
  } catch (error) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}

type Status =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; summary: RewardSummaryResponse };

export function RewardClaimStatus({ address }: { address: string | null }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });

  useEffect(() => {
    if (!address) {
      setStatus({ state: "idle" });
      return;
    }

    let cancelled = false;
    const run = async () => {
      setStatus({ state: "loading" });
      try {
        const res = await fetch(`/api/rewards/${address}`);
        if (!res.ok) {
          throw new Error(`Request failed ${res.status}`);
        }
        const payload = (await res.json()) as RewardSummaryResponse;
        if (!cancelled) {
          setStatus({ state: "ready", summary: payload });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({ state: "error" });
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address) {
    return <p className="bk-text-2xs bk-text-brand-muted">Set BK_ME to track claimable rewards.</p>;
  }

  if (status.state === "idle" || status.state === "loading") {
    return <p className="bk-text-2xs bk-text-brand-muted">Loading claim status…</p>;
  }

  if (status.state === "error") {
    return <p className="bk-text-2xs bk-text-brand-muted">Indexer unavailable. Retry shortly.</p>;
  }

  const { summary } = status;
  const claimable = microsToNumber(summary.totals.claimable);
  const claimed = microsToNumber(summary.totals.claimed);
  const pending = microsToNumber(summary.totals.pending);
  const pendingEpochs = useMemo(
    () => summary.epochs.filter((epoch) => epoch.status === "pending" && microsToNumber(epoch.claimable) > 0),
    [summary.epochs]
  );
  const providerSyncedAt = summary.providerSyncedAt ? new Date(summary.providerSyncedAt * 1000).toLocaleString() : "Not yet synced";
  const indexerSyncedAt = summary.syncedAt ? new Date(summary.syncedAt * 1000).toLocaleString() : "Unknown";

  return (
    <div className="bk-space-y-3">
      <div className="bk-flex bk-items-center bk-justify-between">
        <div>
          <h3 className="bk-text-sm bk-text-brand-muted">Claim status</h3>
          <p className="bk-text-2xs bk-text-brand-muted">Distributor synced {providerSyncedAt}</p>
        </div>
        <span className="bk-text-2xs bk-text-brand-muted">Last root #{summary.lastRootEpoch ?? '–'}</span>
      </div>
      <div className="bk-grid bk-grid-cols-3 bk-gap-3">
        <div className="bk-rounded-xl bk-bg-brand-surface bk-p-3">
          <div className="bk-text-2xs bk-text-brand-muted">Claimable</div>
          <div className="bk-text-sm bk-text-brand-text bk-tabular-nums">{formatMoney(claimable)}</div>
        </div>
        <div className="bk-rounded-xl bk-bg-brand-surface bk-p-3">
          <div className="bk-text-2xs bk-text-brand-muted">Pending</div>
          <div className="bk-text-sm bk-text-brand-text bk-tabular-nums">{formatMoney(pending)}</div>
        </div>
        <div className="bk-rounded-xl bk-bg-brand-surface bk-p-3">
          <div className="bk-text-2xs bk-text-brand-muted">Claimed</div>
          <div className="bk-text-sm bk-text-brand-text bk-tabular-nums">{formatMoney(claimed)}</div>
        </div>
      </div>
      <p className="bk-text-2xs bk-text-brand-muted">
        Claim your rewards through the Context app or CLI. This dashboard only tracks the amounts available.
      </p>
      {pendingEpochs.length > 0 ? (
        <div className="bk-space-y-2">
          <p className="bk-text-2xs bk-text-brand-muted">Pending epochs</p>
          <ul className="bk-space-y-1">
            {pendingEpochs.map((epoch) => (
              <li key={epoch.epochId} className="bk-flex bk-justify-between bk-text-2xs bk-text-brand-muted bk-tabular-nums">
                <span>Epoch {epoch.epochId}</span>
                <span>{formatMoney(microsToNumber(epoch.claimable))}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="bk-text-2xs bk-text-brand-muted">All recent rewards claimed. Indexer last synced {indexerSyncedAt}.</p>
      )}
    </div>
  );
}
