import { NextResponse } from "next/server";
import { fetchIndexerJson, getIndexerBaseUrl } from "@/lib/indexer";

type IndexerRewardSummary = {
  address: string;
  epochs: Array<
    | {
        epochId: number;
        status: "claimed";
        claimed: string;
        txHash: string | null;
      }
    | {
        epochId: number;
        status: "pending";
      }
  >;
  totals: {
    claimable: string;
    claimed: string;
    pending: string;
  };
  lastRootEpoch: number | null;
  syncedAt: number;
};

type ProviderClaimSummary = {
  totalClaimable: bigint;
  epochClaimable: Map<number, bigint>;
};

function serializeEpochs(epochs: IndexerRewardSummary["epochs"], claimable: Map<number, bigint>) {
  return epochs.map((epoch) => ({
    epochId: epoch.epochId,
    status: epoch.status,
    claimed: epoch.status === "claimed" ? epoch.claimed : "0",
    txHash: epoch.status === "claimed" ? epoch.txHash : null,
    claimable: microsToDecimalString(claimable.get(epoch.epochId) ?? 0n)
  }));
}

function microsToDecimalString(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const fraction = abs % 1_000_000n;
  const fractionStr = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  const base = fractionStr.length > 0 ? `${whole}.${fractionStr}` : whole.toString();
  return negative ? `-${base}` : base;
}

async function fetchProviderClaims(address: string): Promise<ProviderClaimSummary | null> {
  const base = process.env.REWARDS_PROVIDER_BASE_URL?.trim();
  if (!base) return null;
  const url = `${base.replace(/\/$/, "")}/claims?address=${address}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      totalClaimable?: string | number;
      epochs?: Array<{ epochId?: number; epoch?: number; claimable?: string | number }>;
    };
    const epochClaimable = new Map<number, bigint>();
    if (Array.isArray(payload?.epochs)) {
      for (const entry of payload.epochs) {
        const epochId = entry?.epochId ?? entry?.epoch;
        if (epochId == null) continue;
        const raw = entry?.claimable ?? 0;
        try {
          const value = typeof raw === "string" ? BigInt(raw) : BigInt(Math.trunc(Number(raw)));
          if (value > 0) {
            epochClaimable.set(Number(epochId), value);
          }
        } catch (error) {
          continue;
        }
      }
    }
    let totalClaimable = 0n;
    for (const value of epochClaimable.values()) {
      totalClaimable += value;
    }
    if (payload?.totalClaimable != null) {
      try {
        const parsedTotal = typeof payload.totalClaimable === "string"
          ? BigInt(payload.totalClaimable)
          : BigInt(Math.trunc(Number(payload.totalClaimable)));
        totalClaimable = parsedTotal;
      } catch (error) {
        // ignore malformed total
      }
    }
    return { totalClaimable, epochClaimable };
  } catch (error) {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: { address: string } }) {
  const baseUrl = getIndexerBaseUrl();
  if (!baseUrl) {
    return NextResponse.json({ error: "indexer_unavailable" }, { status: 503 });
  }

  const addressParam = params.address?.trim();
  if (!addressParam) {
    return NextResponse.json({ error: "missing_address" }, { status: 400 });
  }

  const normalized = addressParam.toLowerCase();

  try {
    const summary = await fetchIndexerJson<IndexerRewardSummary>(`/rewards/${normalized}`);
    const provider = await fetchProviderClaims(normalized);
    const claimableMap = provider?.epochClaimable ?? new Map<number, bigint>();
    const epochs = serializeEpochs(summary.epochs, claimableMap);
    const claimableTotal = provider?.totalClaimable ?? 0n;
    const pendingTotalMicro = provider
      ? summary.epochs.reduce((acc, epoch) => {
          if (epoch.status === "pending") {
            return acc + (claimableMap.get(epoch.epochId) ?? 0n);
          }
          return acc;
        }, 0n)
      : 0n;
    return NextResponse.json({
      address: summary.address,
      epochs,
      totals: {
        claimable: provider ? microsToDecimalString(claimableTotal) : summary.totals.claimable,
        claimed: summary.totals.claimed,
        pending: provider ? microsToDecimalString(pendingTotalMicro) : summary.totals.pending
      },
      lastRootEpoch: summary.lastRootEpoch,
      syncedAt: summary.syncedAt,
      providerSyncedAt: provider ? Math.floor(Date.now() / 1000) : null
    });
  } catch (error) {
    const message = String((error as Error).message ?? "indexer_failure");
    const status = message.includes("Missing INDEXER_URL") ? 503 : 502;
    return NextResponse.json({ error: "rewards_fetch_failed" }, { status });
  }
}
