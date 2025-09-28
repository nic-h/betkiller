import { JsonRpcProvider, Log } from "ethers";
import {
  rewardDistributorInterface,
  erc20Interface,
  blockTimestamp,
  normalizeEpochId,
  normalizeTxHash,
  toLower,
  enqueueProfile
} from "../handlers.js";
import {
  insertRewardEvent,
  upsertRewardEpoch,
  upsertRewardClaim,
  hasRewardClaimForTx,
  setRewardsSyncMeta
} from "../db.js";
import { env } from "../env.js";

const distributorAddress = env.rewardDistributor.toLowerCase();

function parseEpochId(value: any): number {
  const normalized = normalizeEpochId(value);
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function microsFromAmount(value: any): bigint {
  try {
    return BigInt(value?.toString?.() ?? value ?? 0n);
  } catch (error) {
    return 0n;
  }
}

function recordClaim(epochId: number, wallet: string, amount: bigint, txHash: string, blockTime: number) {
  if (epochId <= 0) return;
  upsertRewardClaim({ epochId, wallet, amount, txHash, blockTime });
  insertRewardEvent({ ts: blockTime, kind: "claim", epochId: String(epochId), user: wallet, amount });
  enqueueProfile(wallet);
}

export async function handleRewardDistributorLog(provider: JsonRpcProvider, log: Log) {
  let parsed: any;
  try {
    parsed = rewardDistributorInterface.parseLog(log as any);
  } catch (error) {
    return;
  }

  const eventName = parsed?.name ?? parsed?.fragment?.name;
  if (!eventName) return;

  const blockNum = typeof log.blockNumber === "number" ? log.blockNumber : Number(log.blockNumber ?? 0);
  const ts = await blockTimestamp(provider, blockNum);
  const txHash = normalizeTxHash(log.transactionHash);

  switch (eventName) {
    case "EpochRootSet": {
      const epochId = parseEpochId(parsed?.args?.epochId ?? parsed?.args?.epochID);
      if (!epochId) break;
      const root = parsed?.args?.merkleRoot ? String(parsed.args.merkleRoot) : parsed?.args?.root ? String(parsed.args.root) : "";
      upsertRewardEpoch({ epochId, root, txHash, blockTime: ts });
      insertRewardEvent({ ts, kind: "root", epochId: String(epochId), root });
      setRewardsSyncMeta(blockNum, ts);
      break;
    }
    case "RewardClaimed": {
      const epochId = parseEpochId(parsed?.args?.epochId ?? parsed?.args?.epochID);
      const user = toLower(parsed?.args?.user);
      if (!user || !epochId) break;
      const amount = microsFromAmount(parsed?.args?.amount);
      recordClaim(epochId, user, amount, txHash, ts);
      setRewardsSyncMeta(blockNum, ts);
      break;
    }
    default:
      break;
  }
}

export async function handleRewardTransferLog(provider: JsonRpcProvider, log: Log) {
  let parsed: any;
  try {
    parsed = erc20Interface.parseLog(log as any);
  } catch (error) {
    return;
  }

  const fromAddr = toLower(parsed?.args?.from);
  if (!fromAddr || fromAddr !== distributorAddress) return;

  const toAddr = toLower(parsed?.args?.to);
  if (!toAddr) return;

  const txHash = normalizeTxHash(log.transactionHash);
  if (hasRewardClaimForTx(txHash)) {
    return;
  }

  const blockNum = typeof log.blockNumber === "number" ? log.blockNumber : Number(log.blockNumber ?? 0);
  const ts = await blockTimestamp(provider, blockNum);

  const tx = await provider.getTransaction(log.transactionHash as `0x${string}`);
  if (!tx) return;

  let parsedTx: any;
  try {
    parsedTx = rewardDistributorInterface.parseTransaction({ data: tx.data, value: tx.value });
  } catch (error) {
    return;
  }

  if (!parsedTx?.name) return;

  if (parsedTx.name === "claimReward") {
    const epochId = parseEpochId(parsedTx.args?.[0]);
    const amount = microsFromAmount(parsedTx.args?.[1]);
    if (epochId) {
      recordClaim(epochId, toAddr, amount, txHash, ts);
      setRewardsSyncMeta(blockNum, ts);
    }
    return;
  }

  if (parsedTx.name === "batchClaimRewards") {
    const epochIds = Array.isArray(parsedTx.args?.[0]) ? parsedTx.args[0] : [];
    const amounts = Array.isArray(parsedTx.args?.[1]) ? parsedTx.args[1] : [];
    const count = Math.min(epochIds.length, amounts.length);
    if (count === 0) return;
    for (let i = 0; i < count; i++) {
      const epochId = parseEpochId(epochIds[i]);
      if (!epochId) continue;
      const amount = microsFromAmount(amounts[i]);
      recordClaim(epochId, toAddr, amount, txHash, ts);
    }
    setRewardsSyncMeta(blockNum, ts);
  }
}
