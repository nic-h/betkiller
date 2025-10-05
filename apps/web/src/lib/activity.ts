import { getDatabase } from "@/lib/database";
import { fromMicros } from "@/lib/num";
import { normalizeRange, type RangeKey } from "@/lib/range";

export type ActivityEvent = {
  ts: number;
  type: "reward" | "boost" | "trade";
  address: string | null;
  name: string | null;
  marketId: string | null;
  description: string;
  amount: number | null;
};

export function getRecentActivity(range: RangeKey, limit = 5): ActivityEvent[] {
  const normalized = normalizeRange(range);
  const db = getDatabase();
  const since = rangeCutoffSeconds(normalized);

  const rewards = db
    .prepare(
      `SELECT block_time AS ts, wallet, amount_usdc AS amount
       FROM reward_claims
       WHERE block_time >= ?
       ORDER BY block_time DESC
       LIMIT ?`
    )
    .all(since, limit) as { ts: number; wallet: string | null; amount: string | number | null }[];

  const boosts = db
    .prepare(
      `SELECT ts, user, marketId, payloadJson
       FROM locks
       WHERE ts >= ? AND lower(type) = 'sponsored'
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(since, limit) as { ts: number; user: string | null; marketId: string | null; payloadJson: string | null }[];

  const trades = db
    .prepare(
      `SELECT ts, marketId, trader, usdcIn, usdcOut
       FROM trades
       WHERE ts >= ?
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(since, limit) as {
    ts: number;
    marketId: string | null;
    trader: string | null;
    usdcIn: string | number | null;
    usdcOut: string | number | null;
  }[];

  const profiles = new Map<string, string>();
  const collect = (addr: string | null | undefined) => {
    if (!addr) return;
    const normalizedAddr = addr.toLowerCase();
    if (!profiles.has(normalizedAddr)) profiles.set(normalizedAddr, "");
  };

  for (const row of rewards) collect(row.wallet);
  for (const row of boosts) collect(row.user);
  for (const row of trades) collect(row.trader);

  if (profiles.size > 0) {
    const addresses = Array.from(profiles.keys());
    const placeholders = addresses.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT lower(address) AS addr, display_name AS displayName
         FROM profiles
         WHERE lower(address) IN (${placeholders})`
      )
      .all(...addresses) as { addr: string; displayName: string | null }[];
    for (const row of rows) {
      profiles.set(row.addr, row.displayName ?? "");
    }
  }

  const events: ActivityEvent[] = [];

  for (const reward of rewards) {
    const address = reward.wallet ? reward.wallet.toLowerCase() : null;
    const amount = Number(fromMicros(reward.amount ?? 0).toFixed(2));
    events.push({
      ts: reward.ts,
      type: "reward",
      address,
      name: resolveDisplayName(address, profiles),
      marketId: null,
      description: `claimed $${amount.toFixed(2)}`,
      amount
    });
  }

  for (const boost of boosts) {
    const address = boost.user ? boost.user.toLowerCase() : null;
    const amount = parseBoostAmount(boost.payloadJson);
    events.push({
      ts: boost.ts,
      type: "boost",
      address,
      name: resolveDisplayName(address, profiles),
      marketId: boost.marketId ?? null,
      description: amount ? `boosted $${amount.toFixed(2)}` : "boosted liquidity",
      amount
    });
  }

  for (const trade of trades) {
    const address = trade.trader ? trade.trader.toLowerCase() : null;
    const inAmount = Number(fromMicros(trade.usdcIn ?? 0).toFixed(2));
    const outAmount = Number(fromMicros(trade.usdcOut ?? 0).toFixed(2));
    const gross = inAmount + outAmount;
    const net = outAmount - inAmount;
    const direction = net >= 0 ? "sold" : "bought";
    const amount = Math.abs(gross);
    events.push({
      ts: trade.ts,
      type: "trade",
      address,
      name: resolveDisplayName(address, profiles),
      marketId: trade.marketId ?? null,
      description: `${direction} $${amount.toFixed(2)}`,
      amount
    });
  }

  return events
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

function parseBoostAmount(payloadJson: string | null): number | null {
  if (!payloadJson) return null;
  try {
    const parsed = JSON.parse(payloadJson);
    if (parsed?.actualCost != null) {
      return Number(fromMicros(parsed.actualCost).toFixed(2));
    }
    let total = 0;
    if (parsed?.userPaid != null) total += Number(fromMicros(parsed.userPaid).toFixed(2));
    if (parsed?.subsidyUsed != null) total += Number(fromMicros(parsed.subsidyUsed).toFixed(2));
    return total === 0 ? null : Number(total.toFixed(2));
  } catch (error) {
    return null;
  }
}

function resolveDisplayName(address: string | null, profiles: Map<string, string>): string | null {
  if (!address) return null;
  const display = profiles.get(address);
  if (display && display.trim()) return display.trim();
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
