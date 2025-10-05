import { getDatabase, toMicroNumber } from "@/lib/database";
import { fromMicros } from "@/lib/num";
import { normalizeRange, type RangeKey } from "@/lib/range";

export type KPI = {
  key: "capital" | "locked" | "available" | "pnl";
  label: string;
  value: number;
};

export function getKpis(range: RangeKey): KPI[] {
  const normalized = normalizeRange(range);
  const db = getDatabase();
  const since = rangeCutoffSeconds(normalized);

  const positionRows = db
    .prepare(
      `SELECT SUM(CAST(usdcIn AS INTEGER)) AS totalIn,
              SUM(CAST(usdcOut AS INTEGER)) AS totalOut
         FROM trades
        GROUP BY marketId`
    )
    .all() as { totalIn: string | number | null; totalOut: string | number | null }[];

  let capitalMicros = 0n;
  for (const row of positionRows) {
    const totalIn = toMicroNumber(row.totalIn);
    const totalOut = toMicroNumber(row.totalOut);
    if (totalIn > totalOut) {
      capitalMicros += totalIn - totalOut;
    }
  }
  const capital = Number(fromMicros(capitalMicros).toFixed(2));

  const boostRows = db
    .prepare(
      `SELECT type, payloadJson
         FROM locks`
    )
    .all() as { type: string | null; payloadJson: string | null }[];

  let sponsored = 0n;
  let unlocked = 0n;
  for (const row of boostRows) {
    const kind = (row.type ?? "").toLowerCase();
    if (kind === "sponsored") {
      sponsored += parseSponsoredAmount(row.payloadJson);
    } else if (kind === "unlock" || kind === "unlocked") {
      unlocked += parseUnlockedAmount(row.payloadJson);
    }
  }
  const boostLocked = sponsored > unlocked ? sponsored - unlocked : 0n;
  const locked = Number(fromMicros(boostLocked).toFixed(2));
  const available = Number(fromMicros(unlocked).toFixed(2));

  const pnlRow = db
    .prepare(
      `SELECT SUM(CAST(amount AS INTEGER)) AS pnl
         FROM rewards
        WHERE kind = 'claim' AND ts >= ?`
    )
    .get(since) as { pnl: string | number | null } | undefined;
  const pnl = Number(fromMicros(pnlRow?.pnl ?? 0).toFixed(2));

  return [
    { key: "capital", label: "Capital deployed", value: capital },
    { key: "locked", label: "Locked boost", value: locked },
    { key: "available", label: "Boost available", value: available },
    { key: "pnl", label: "PnL", value: pnl }
  ];
}

function parseSponsoredAmount(payloadJson: string | null): bigint {
  if (!payloadJson) return 0n;
  try {
    const parsed = JSON.parse(payloadJson);
    let total = 0n;
    if (parsed?.actualCost != null) total += toMicroNumber(parsed.actualCost);
    if (parsed?.userPaid != null) total += toMicroNumber(parsed.userPaid);
    if (parsed?.subsidyUsed != null) total += toMicroNumber(parsed.subsidyUsed);
    return total;
  } catch (error) {
    return 0n;
  }
}

function parseUnlockedAmount(payloadJson: string | null): bigint {
  if (!payloadJson) return 0n;
  try {
    const parsed = JSON.parse(payloadJson);
    if (Array.isArray(parsed?.amounts)) {
      return parsed.amounts.reduce<bigint>((total, value) => total + toMicroNumber(value), 0n);
    }
    return 0n;
  } catch (error) {
    return 0n;
  }
}

function rangeCutoffSeconds(range: RangeKey): number {
  const now = Math.floor(Date.now() / 1000);
  const day = 24 * 60 * 60;
  switch (range) {
    case "24h":
      return now - day;
    case "1w":
      return now - 7 * day;
    case "1m":
    default:
      return now - 30 * day;
  }
}
