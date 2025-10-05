import { CONTRACT_ADDRESSES } from "@/context/addresses";
import { invalidateMarketCache } from "@/context/pricing";
import PredictionMarketAbi from "@/abi/PredictionMarket.json";
import VaultAbi from "@/abi/Vault.json";
import { decodeEventLog, hexToBytes, type Address, type Log } from "viem";
import { gunzipSync } from "node:zlib";
import type { Database } from "better-sqlite3";

const PM_ADDRESS = CONTRACT_ADDRESSES.predictionMarket.toLowerCase();
const VAULT_ADDRESS = CONTRACT_ADDRESSES.vault.toLowerCase();
export function applyLogSideEffects(db: Database, log: Log, timestamp: number) {
  const address = (log.address as Address | undefined)?.toLowerCase();
  if (!address) return;

  if (address === PM_ADDRESS) {
    handlePredictionMarketLog(db, log, timestamp);
  } else if (address === VAULT_ADDRESS) {
    handleVaultLog(db, log);
  }
}

function handlePredictionMarketLog(db: Database, log: Log, timestamp: number) {
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: PredictionMarketAbi as any,
      data: log.data,
      topics: log.topics
    });
  } catch (error) {
    return;
  }

  const { eventName, args } = decoded;
  if (eventName === "MarketCreated") {
    const marketId = pickMarketId(args, "marketId");
    if (!marketId) return;
    const payload = buildMarketPayload(args, decodeMetadata(args.metadata as string | undefined), timestamp);
    db.prepare(
      `INSERT INTO markets(market, creator, oracle, question, short_text, end_time, metadata_json, created_ts, resolved, winning_side, updated_ts)
       VALUES(@market, @creator, @oracle, @question, @short_text, @end_time, @metadata_json, @created_ts, @resolved, @winning_side, @updated_ts)
       ON CONFLICT(market) DO UPDATE SET
         creator=excluded.creator,
         oracle=excluded.oracle,
         question=excluded.question,
         short_text=excluded.short_text,
         end_time=excluded.end_time,
         metadata_json=excluded.metadata_json,
         created_ts=excluded.created_ts,
         updated_ts=excluded.updated_ts,
         resolved=CASE WHEN markets.resolved=1 THEN markets.resolved ELSE excluded.resolved END`
    ).run(payload);
    return;
  }

  if (eventName === "MarketResolved") {
    const marketId = pickMarketId(args, "marketId");
    if (!marketId) return;
    const payoutPcts = Array.isArray(args.payoutPcts)
      ? (args.payoutPcts as Array<string | bigint | number>).map((value) => BigInt(value))
      : [];
    const winningIndex = payoutPcts.findIndex((value) => value > 0n);
    const winningSide = winningIndex === 0 ? "YES" : winningIndex === 1 ? "NO" : winningIndex >= 0 ? `IDX${winningIndex}` : null;

    db.prepare(
      `INSERT INTO resolved_markets(market, resolved_ts, winning_side)
       VALUES(?, ?, ?)
       ON CONFLICT(market) DO UPDATE SET resolved_ts=excluded.resolved_ts, winning_side=excluded.winning_side`
    ).run(marketId, timestamp, winningSide);

    db.prepare(
      `UPDATE markets
         SET resolved = 1,
             winning_side = ?,
             updated_ts = ?
       WHERE market = ?`
    ).run(winningSide, timestamp, marketId);

    // Once a market resolves, cached MTM data is no longer valid.
    invalidateMarketCache(marketId);

    // Claimables will be recomputed on demand; clear stale entries so next read refreshes.
    db.prepare(`DELETE FROM claimables WHERE market = ?`).run(marketId);
    db.prepare(`DELETE FROM boost_positions WHERE market = ?`).run(marketId);
  }
}

function handleVaultLog(db: Database, log: Log) {
  let decoded: ReturnType<typeof decodeEventLog>;
  try {
    decoded = decodeEventLog({
      abi: VaultAbi as any,
      data: log.data,
      topics: log.topics
    });
  } catch (error) {
    return;
  }

  const { eventName, args } = decoded;
  if (eventName === "SponsoredLocked") {
    const market = pickMarketId(args, "marketId");
    const user = pickAddress(args, "user");
    if (!market || !user) return;
    const amount = toBigInt(args.actualCost);
    if (amount === 0n) return;
    db.prepare(
      `INSERT INTO boost_positions(user, market, amount_fp)
       VALUES(?, ?, ?)
       ON CONFLICT(user, market) DO UPDATE SET amount_fp = amount_fp + excluded.amount_fp`
    ).run(user, market, amount.toString());
  }

  if (eventName === "Unlocked") {
    const market = pickMarketId(args, "marketId");
    const user = pickAddress(args, "locker", "user");
    if (!market || !user) return;

    const row = db
      .prepare(`SELECT amount_fp FROM boost_positions WHERE user = ? AND market = ?`)
      .get(user, market) as { amount_fp?: string } | undefined;
    const outstanding = row?.amount_fp !== undefined ? BigInt(row.amount_fp) : 0n;
    if (outstanding > 0n) {
      db.prepare(`UPDATE events_norm SET amount_fp = ? WHERE address = ? AND blk = ? AND logi = ?`).run(
        outstanding.toString(),
        log.address,
        Number(log.blockNumber ?? 0n),
        Number(log.logIndex ?? 0n)
      );
    }
    db.prepare(`DELETE FROM boost_positions WHERE user = ? AND market = ?`).run(user, market);
  }
}

function pickAddress(args: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.startsWith("0x")) {
      return value.toLowerCase();
    }
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

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.length > 0) {
    return BigInt(value);
  }
  return 0n;
}

function decodeMetadata(value: string | undefined) {
  if (!value) return null;
  try {
    const bytes = hexToBytes(value as `0x${string}`);
    const buffer = gunzipSync(bytes);
    const text = buffer.toString("utf8");
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function buildMarketPayload(args: Record<string, unknown>, metadata: any, timestamp: number) {
  const marketId = pickMarketId(args, "marketId");
  return {
    market: marketId,
    creator: pickAddress(args, "creator") ?? null,
    oracle: pickAddress(args, "oracle") ?? null,
    question: metadata?.text ?? null,
    short_text: metadata?.shortText ?? null,
    end_time: typeof metadata?.endTime === "number" ? metadata.endTime : null,
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    created_ts: timestamp,
    resolved: 0,
    winning_side: null,
    updated_ts: timestamp
  };
}
