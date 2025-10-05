import { CONTRACT_ADDRESSES } from "@/context/addresses";
import type { Address, Log } from "viem";
import { decodeEventLog } from "viem";
import VaultAbi from "@/abi/Vault.json";
import PredictionMarketAbi from "@/abi/PredictionMarket.json";
import RewardDistributorAbi from "@/abi/RewardDistributor.json";

type Kind =
  | "DEPOSIT"
  | "WITHDRAW"
  | "BUY"
  | "SELL"
  | "BOOST_ADD"
  | "BOOST_REMOVE"
  | "CLAIM"
  | "REFUND"
  | "REWARD";

type PartialRow = {
  user: Address | null;
  market?: string | null;
  kind: Kind;
  side?: "YES" | "NO" | null;
  amount?: bigint | null;
  shares?: bigint | null;
  fee?: bigint | null;
};

export type NormalizedLedgerRow = {
  address: Address;
  user: Address;
  market: string | null;
  kind: Kind;
  side: "YES" | "NO" | null;
  amount_fp: bigint | null;
  shares_fp: bigint | null;
  fee_fp: bigint | null;
  ts: number;
  txhash: `0x${string}`;
  blk: number;
  logi: number;
};

export type NormalizeContext = {
  log: Log;
  timestamp: number;
};

type Decoder = (context: NormalizeContext) => PartialRow | null;

const DECODERS: Record<string, Decoder> = {
  [CONTRACT_ADDRESSES.vault.toLowerCase()]: decodeVault,
  [CONTRACT_ADDRESSES.predictionMarket.toLowerCase()]: decodePredictionMarket,
  [CONTRACT_ADDRESSES.rewardDistributor.toLowerCase()]: decodeRewards
};

export function normalizeEvent(context: NormalizeContext): NormalizedLedgerRow[] {
  const { log } = context;
  const decoder = DECODERS[log.address?.toLowerCase() ?? ""];
  if (!decoder) return [];

  try {
    const partial = decoder(context);
    if (!partial) return [];
    return [finalizeRow(context, partial)];
  } catch (error) {
    console.warn("Failed to normalize log", {
      address: log.address,
      error: error instanceof Error ? error.message : error
    });
    return [];
  }
}

function finalizeRow(context: NormalizeContext, partial: PartialRow): NormalizedLedgerRow {
  const { log, timestamp } = context;

  if (!partial.user) {
    throw new Error("Missing user address in normalized row");
  }

  const txhash = log.transactionHash as `0x${string}` | undefined;
  if (!txhash) {
    throw new Error("Log missing transaction hash");
  }

  return {
    address: log.address as Address,
    user: partial.user as Address,
    market: partial.market ?? null,
    kind: partial.kind,
    side: partial.side ?? null,
    amount_fp: partial.amount ?? null,
    shares_fp: partial.shares ?? null,
    fee_fp: partial.fee ?? null,
    ts: timestamp,
    txhash,
    blk: Number(log.blockNumber ?? 0n),
    logi: Number(log.logIndex ?? 0n)
  };
}

function decodeVault({ log }: NormalizeContext): PartialRow | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: VaultAbi as any, data: log.data, topics: log.topics });
  } catch (error) {
    return null;
  }

  const { eventName, args } = decoded;

  if (eventName === "SponsoredLocked") {
    const user = pickAddress(args, "user", "locker");
    if (!user) return null;
    const amount = toBigIntOptional(args.actualCost);
    if (!amount || amount === 0n) return null;
    return {
      user,
      market: pickMarketId(args, "marketId"),
      kind: "BOOST_ADD",
      amount
    };
  }

  if (eventName === "Unlocked") {
    const user = pickAddress(args, "locker", "user");
    if (!user) return null;
    return {
      user,
      market: pickMarketId(args, "marketId"),
      kind: "BOOST_REMOVE",
      amount: null
    };
  }

  return null;
}

function decodePredictionMarket({ log }: NormalizeContext): PartialRow | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: PredictionMarketAbi as any, data: log.data, topics: log.topics });
  } catch (error) {
    return null;
  }

  const { eventName, args } = decoded;

  if (eventName === "Buy" || eventName === "Sell") {
    const market = pickMarketId(args, "market", "marketId");
    const user = pickAddress(args, "user", "trader");
    const yes = Boolean(args.yes);
    const shares = toBigIntOptional(args.shares ?? args.quantity);
    const fee = toBigIntOptional(args.fee);
    const amountField = eventName === "Buy" ? args.cost ?? args.amount : args.proceeds ?? args.amount;
    const amount = toBigIntOptional(amountField);

    return {
      user,
      market,
      kind: eventName === "Buy" ? "BUY" : "SELL",
      side: yes ? "YES" : "NO",
      amount,
      shares,
      fee
    };
  }

  if (eventName === "MarketTraded") {
    const trader = pickAddress(args, "trader", "user");
    if (!trader) return null;

    const costDelta = toBigInt(args.usdcFlow);
    if (costDelta === 0n) return null;

    const market = pickMarketId(args, "market", "marketId");
    const deltaShares = Array.isArray(args.deltaShares)
      ? (args.deltaShares as Array<string | bigint | number>).map(toBigInt)
      : [];

    const isBuy = costDelta > 0n;
    const amount = bigintAbs(costDelta);
    const shareInfo = deriveShare(deltaShares, isBuy ? 1 : -1);

    return {
      user: trader,
      market,
      kind: isBuy ? "BUY" : "SELL",
      side: shareInfo.side,
      amount,
      shares: shareInfo.shares,
      fee: null
    };
  }

  if (eventName === "Claim" || eventName === "TokensRedeemed") {
    const user = pickAddress(args, "user", "redeemer");
    if (!user) return null;
    const market = pickMarketId(args, "market", "marketId");
    return {
      user,
      market,
      kind: "CLAIM",
      amount: toBigIntOptional(args.payout ?? args.amount),
      shares: toBigIntOptional(args.shares)
    };
  }

  if (eventName === "Refund") {
    const user = pickAddress(args, "user", "claimer");
    if (!user) return null;
    const market = pickMarketId(args, "market", "marketId");
    return {
      user,
      market,
      kind: "REFUND",
      amount: toBigIntOptional(args.amount)
    };
  }

  if (eventName === "BoostAdded" || eventName === "BoostRemoved") {
    const market = pickMarketId(args, "market", "marketId");
    const user = pickAddress(args, "user", "claimer");
    if (!user) return null;
    return {
      user,
      market,
      kind: eventName === "BoostAdded" ? "BOOST_ADD" : "BOOST_REMOVE",
      amount: toBigIntOptional(args.amount)
    };
  }

  return null;
}

function decodeRewards({ log }: NormalizeContext): PartialRow | null {
  let decoded;
  try {
    decoded = decodeEventLog({ abi: RewardDistributorAbi as any, data: log.data, topics: log.topics });
  } catch (error) {
    return null;
  }

  const { eventName, args } = decoded;
  if (eventName === "RewardPaid" || eventName === "RewardClaimed") {
    const user = pickAddress(args, "user", "claimer");
    if (!user) return null;
    return {
      user,
      kind: "REWARD",
      amount: toBigIntOptional(args.amount)
    };
  }

  return null;
}

function toOptionalAddress(value: unknown): Address | null {
  if (typeof value === "string" && value.startsWith("0x") && value.length >= 42) {
    return value.toLowerCase() as Address;
  }
  return null;
}

function toBigIntOptional(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) {
    try {
      return value.startsWith("0x") ? BigInt(value) : BigInt(value);
    } catch (error) {
      return null;
    }
  }
  return null;
}

function toBigInt(value: unknown): bigint {
  return toBigIntOptional(value) ?? 0n;
}

function bigintAbs(value: bigint): bigint {
  return value >= 0n ? value : -value;
}

function deriveShare(deltaShares: bigint[], direction: 1 | -1) {
  for (let i = 0; i < deltaShares.length; i += 1) {
    const delta = deltaShares[i];
    if (direction === 1 && delta > 0n) {
      return {
        side: i === 0 ? "YES" : (i === 1 ? "NO" : null),
        shares: delta
      };
    }
    if (direction === -1 && delta < 0n) {
      return {
        side: i === 0 ? "YES" : (i === 1 ? "NO" : null),
        shares: -delta
      };
    }
  }

  return {
    side: null,
    shares: null
  } as const;
}

function pickAddress(args: Record<string, unknown>, ...keys: string[]): Address | null {
  for (const key of keys) {
    const candidate = toOptionalAddress(args[key]);
    if (candidate) return candidate;
  }
  return null;
}

function pickMarketId(args: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.startsWith("0x")) {
      return value.toLowerCase();
    }
  }
  return null;
}
