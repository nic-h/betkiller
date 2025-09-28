'use client';

import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/fmt";
import { useAccount, useConnect, useDisconnect, useSwitchChain, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import RewardDistributorAbi from "@/abis/RewardDistributor.json";

const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_REWARD_DISTRIBUTOR ?? "").toLowerCase();
const TARGET_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "8453");

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

function decimalToMicros(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  const normalizedWhole = whole.replace(/[^0-9]/g, "") || "0";
  const normalizedFraction = (fraction.replace(/[^0-9]/g, "") + "000000").slice(0, 6);
  return BigInt(normalizedWhole + normalizedFraction);
}

type Status =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error" }
  | { state: "ready"; summary: RewardSummaryResponse };

export function RewardClaimStatus({ address }: { address: string | null }) {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const { connect } = useConnect({ connector: injected() });
  const { disconnect } = useDisconnect();
  const { address: walletAddress, isConnected, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    if (!address) {
      setStatus({ state: "idle" });
      return;
    }

    let cancelled = false;
    const run = async (silent = false) => {
      if (!silent) {
        setStatus({ state: "loading" });
      }
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
  const providerSyncedAt = summary.providerSyncedAt ? new Date(summary.providerSyncedAt * 1000) : null;
  const providerLabel = providerSyncedAt ? providerSyncedAt.toLocaleString() : null;

  const handleClaim = async () => {
    if (!address || pendingEpochs.length === 0) return;
    if (!isConnected) {
      connect();
      return;
    }
    if (TARGET_CHAIN_ID && chainId !== TARGET_CHAIN_ID) {
      try {
        await switchChain({ chainId: TARGET_CHAIN_ID });
      } catch (error) {
        setClaimError("Switch to the Base network to claim.");
        return;
      }
    }
    if (!CONTRACT_ADDRESS) {
      setClaimError("Reward distributor address missing.");
      return;
    }

    setClaimError(null);
    setClaiming(true);
    try {
      const epochIds = pendingEpochs.map((epoch) => epoch.epochId);
      const proofRes = await fetch(`/api/rewards/${address}/proofs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ epochIds })
      });
      if (!proofRes.ok) {
        throw new Error("Failed to load proofs");
      }
      const payload = (await proofRes.json()) as {
        proofs?: Array<{ epochId: number; amount: string; proof: string[] }>;
      };
      const proofMap = new Map<number, { amount: string; proof: string[] }>();
      for (const entry of payload.proofs ?? []) {
        proofMap.set(entry.epochId, entry);
      }
      const amounts: bigint[] = [];
      const proofs: string[][] = [];
      const missing: number[] = [];
      for (const epoch of epochIds) {
        const entry = proofMap.get(epoch);
        if (!entry) {
          missing.push(epoch);
          continue;
        }
        amounts.push(decimalToMicros(entry.amount ?? "0"));
        proofs.push(entry.proof ?? []);
      }
      if (missing.length > 0) {
        throw new Error(`Missing proofs for epochs ${missing.join(", ")}`);
      }

      await writeContractAsync({
        abi: RewardDistributorAbi.abi,
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: "batchClaimRewards",
        args: [epochIds, amounts, proofs]
      });

      const refreshed = await fetch(`/api/rewards/${address}`);
      if (refreshed.ok) {
        const summary = (await refreshed.json()) as RewardSummaryResponse;
        setStatus({ state: "ready", summary });
      }
    } catch (error) {
      setClaimError((error as Error).message ?? "Claim failed");
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="bk-flex bk-flex-col bk-gap-2">
      <div className="bk-flex bk-items-center bk-justify-between">
        <div className="bk-flex bk-items-center bk-gap-2">
          {isConnected ? (
            <span className="bk-rounded-full bk-bg-brand-surface bk-px-3 bk-py-1 bk-text-2xs bk-text-brand-muted">
              Connected {shortAddress(walletAddress)}
            </span>
          ) : (
            <button
              type="button"
              className="bk-rounded-full bk-bg-brand-blue bk-text-black bk-px-3 bk-py-1 bk-text-2xs bk-font-medium hover:bk-bg-brand-blue/90"
              onClick={() => connect()}
            >
              Connect wallet
            </button>
          )}
          {isConnected && (
            <button
              type="button"
              className="bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-3 bk-py-1 bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
              onClick={() => disconnect()}
            >
              Disconnect
            </button>
          )}
        </div>
        {claimError && <span className="bk-text-2xs bk-text-danger">{claimError}</span>}
      </div>
      <div className="bk-grid bk-grid-cols-3 bk-gap-2">
        <div className="bk-rounded-xl bk-bg-brand-surface bk-p-3">
          <p className="bk-text-2xs bk-text-brand-muted">Claimable</p>
          <p className="bk-text-sm bk-text-brand-text bk-tabular-nums">{formatMoney(claimable)}</p>
        </div>
        <div className="bk-rounded-xl bk-bg-brand-surface bk-p-3">
          <p className="bk-text-2xs bk-text-brand-muted">Claimed</p>
          <p className="bk-text-sm bk-text-brand-text bk-tabular-nums">{formatMoney(claimed)}</p>
        </div>
        <div className="bk-rounded-xl bk-bg-brand-surface bk-p-3">
          <p className="bk-text-2xs bk-text-brand-muted">Pending</p>
          <p className="bk-text-sm bk-text-brand-text bk-tabular-nums">{formatMoney(pending)}</p>
        </div>
      </div>
      {pendingEpochs.length > 0 ? (
        <div className="bk-flex bk-items-center bk-justify-between bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-p-3">
          <div>
            <p className="bk-text-xs bk-text-brand-text">{pendingEpochs.length} pending epoch(s)</p>
            <p className="bk-text-2xs bk-text-brand-muted">Last root #{summary.lastRootEpoch ?? "–"}</p>
            {providerLabel && <p className="bk-text-2xs bk-text-brand-muted">Proofs synced {providerLabel}</p>}
          </div>
          <button
            type="button"
            className="bk-rounded-full bk-bg-brand-blue bk-text-black bk-px-4 bk-py-2 bk-text-xs bk-font-medium hover:bk-bg-brand-blue/90"
            disabled={claiming}
            onClick={handleClaim}
          >
            {claiming ? "Claiming…" : "Claim all"}
          </button>
        </div>
      ) : pending > 0 ? (
        <p className="bk-text-2xs bk-text-brand-muted">Proofs synced; waiting for Merkl claim window.</p>
      ) : (
        <p className="bk-text-2xs bk-text-brand-muted">All rewards claimed. Synced at {summary.syncedAt ? new Date(summary.syncedAt * 1000).toLocaleString() : "–"}.</p>
      )}
      {pendingEpochs.length > 0 && (
        <ul className="bk-space-y-1 bk-text-2xs bk-text-brand-muted">
          {pendingEpochs.map((epoch) => (
            <li key={epoch.epochId} className="bk-flex bk-justify-between bk-tabular-nums">
              <span>Epoch #{epoch.epochId}</span>
              <span>{formatMoney(microsToNumber(epoch.claimable))}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shortAddress(value: string | null | undefined): string {
  if (!value) return "";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
