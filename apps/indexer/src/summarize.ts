import fs from 'node:fs';
import path from 'node:path';
import { decodeEventLog } from 'viem';
import { predictionMarketAbi, vaultAbi, rewardDistributorAbi } from './abi.js';

const ADDRESSES_FILE = path.resolve(process.env.ADDRESSES_FILE ?? './src/context.addresses.base.json');
const LOGS_FILE = path.resolve('data/context_logs.jsonl');
const PROFILES_FILE = path.resolve('data/context_profiles.jsonl');
const OUTPUT_FILE = path.resolve('data/context_summary.json');
const USDC_DECIMALS = 1_000_000n;

function coerceBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') {
    if (value.startsWith('0x') || value.startsWith('0X')) {
      return BigInt(value);
    }
    if (value.trim().length === 0) return 0n;
    return BigInt(value);
  }
  return 0n;
}

type Profile = { displayName: string | null; xHandle: string | null };

type TraderStats = {
  address: string;
  trades: number;
  volume: bigint;
  spent: bigint;
  received: bigint;
  payouts: bigint;
  rewards: bigint;
  surplus: bigint;
  net: bigint;
  profile?: Profile;
};

type MarketStats = {
  marketId: string;
  creator?: string;
  oracle?: string;
  questionId?: string;
  outcomeCount?: number;
  creationFee: bigint;
  totalUsdc: bigint;
  tradedVolume: bigint;
  resolved: boolean;
  surplusAccrued: bigint;
  lastEventBlock?: string;
};

type AddressBook = {
  predictionMarket: string;
  vault: string;
  rewardDistributor: string;
};

function loadAddresses(): AddressBook {
  const json = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8')) as AddressBook & { chainId: number };
  return {
    predictionMarket: json.predictionMarket.toLowerCase(),
    vault: json.vault.toLowerCase(),
    rewardDistributor: json.rewardDistributor.toLowerCase(),
  };
}

function loadProfiles(): Map<string, Profile> {
  if (!fs.existsSync(PROFILES_FILE)) return new Map();
  const lines = fs.readFileSync(PROFILES_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const map = new Map<string, Profile>();
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { address: string; displayName?: string | null; xHandle?: string | null };
      const address = row.address.toLowerCase();
      map.set(address, { displayName: row.displayName ?? null, xHandle: row.xHandle ?? null });
    } catch (error) {
      continue;
    }
  }
  return map;
}

function ensureTrader(map: Map<string, TraderStats>, address: string, profileBook: Map<string, Profile>): TraderStats {
  const key = address.toLowerCase();
  let row = map.get(key);
  if (!row) {
    row = {
      address: key,
      trades: 0,
      volume: 0n,
      spent: 0n,
      received: 0n,
      payouts: 0n,
      rewards: 0n,
      surplus: 0n,
      net: 0n,
      profile: profileBook.get(key) ?? undefined,
    };
    map.set(key, row);
  }
  return row;
}

function ensureMarket(map: Map<string, MarketStats>, marketId: string): MarketStats {
  let row = map.get(marketId);
  if (!row) {
    row = {
      marketId,
      creationFee: 0n,
      totalUsdc: 0n,
      tradedVolume: 0n,
      resolved: false,
      surplusAccrued: 0n,
    };
    map.set(marketId, row);
  }
  return row;
}

function bigintAbs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function toUsd(value: bigint): number {
  return Number(value) / Number(USDC_DECIMALS);
}

async function main() {
  if (!fs.existsSync(LOGS_FILE)) {
    throw new Error(`Missing logs file: ${LOGS_FILE}`);
  }

  const addresses = loadAddresses();
  const profileBook = loadProfiles();

  const traders = new Map<string, TraderStats>();
  const markets = new Map<string, MarketStats>();
  const systemAddresses = new Set([
    addresses.predictionMarket,
    addresses.vault,
    addresses.rewardDistributor,
  ]);

  const indexer: Record<string, any> = {
    [addresses.predictionMarket]: predictionMarketAbi,
    [addresses.vault]: vaultAbi,
    [addresses.rewardDistributor]: rewardDistributorAbi,
  };

  const lines = fs.readFileSync(LOGS_FILE, 'utf8').trim().split('\n').filter(Boolean);

  for (const line of lines) {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      continue;
    }

    const address = (parsed.address ?? '').toLowerCase();
    const abi = indexer[address];
    if (!abi) continue;

    const topicsRaw = Array.isArray(parsed.topics)
      ? parsed.topics.filter((t: unknown): t is string => typeof t === 'string')
      : [];
    if (topicsRaw.length === 0) continue;

    try {
      const decoded = decodeEventLog({
        abi,
        data: parsed.data ?? '0x',
        topics: topicsRaw as [`0x${string}`, ...`0x${string}`[]],
        strict: false,
      }) as any;
      const eventName = decoded.eventName as string;
      const args = decoded.args as Record<string, unknown>;

      if (abi === predictionMarketAbi) {
        handlePredictionMarketEvent(eventName, args, traders, markets, profileBook, systemAddresses, parsed.blockNumber);
      } else if (abi === vaultAbi) {
        handleVaultEvent(eventName, args, traders, profileBook);
      } else if (abi === rewardDistributorAbi) {
        handleRewardEvent(eventName, args, traders, profileBook);
      }
    } catch (error) {
      continue;
    }
  }

  const summary = buildSummary(traders, markets);
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ msg: 'summary written', file: OUTPUT_FILE }));
}

function handlePredictionMarketEvent(
  eventName: string,
  args: Record<string, unknown>,
  traders: Map<string, TraderStats>,
  markets: Map<string, MarketStats>,
  profiles: Map<string, Profile>,
  systemAddresses: Set<string>,
  blockNumber?: string,
) {
  switch (eventName) {
    case 'MarketCreated': {
      const marketId = String(args.marketId);
      const market = ensureMarket(markets, marketId);
      const fee = coerceBigInt(args.marketCreationFee);
      market.creationFee += fee;
      market.totalUsdc += fee;
      market.creator = (args.creator as string | undefined)?.toLowerCase();
      market.oracle = (args.oracle as string | undefined)?.toLowerCase();
      market.questionId = args.questionId as string | undefined;
      const names = args.outcomeNames as string[] | undefined;
      market.outcomeCount = names?.length;
      market.lastEventBlock = blockNumber;
      break;
    }
    case 'MarketTraded': {
      const traderAddr = (args.trader as string | undefined)?.toLowerCase();
      const marketId = String(args.marketId);
      if (!traderAddr || systemAddresses.has(traderAddr)) break;
      const market = ensureMarket(markets, marketId);
      market.lastEventBlock = blockNumber;
      const row = ensureTrader(traders, traderAddr, profiles);
      const costDelta = coerceBigInt(args.usdcFlow);
      const absCost = bigintAbs(costDelta);
      market.tradedVolume += absCost;
      row.trades += 1;
      row.volume += absCost;
      if (costDelta > 0n) {
        row.spent += costDelta;
        market.totalUsdc += costDelta;
      } else if (costDelta < 0n) {
        const received = -costDelta;
        row.received += received;
        market.totalUsdc -= received;
      }
      break;
    }
    case 'TokensRedeemed': {
      const redeemer = (args.redeemer as string | undefined)?.toLowerCase();
      const marketId = String(args.marketId);
      const payout = coerceBigInt(args.payout);
      if (redeemer) {
        const row = ensureTrader(traders, redeemer, profiles);
        row.received += payout;
        row.payouts += payout;
      }
      const market = ensureMarket(markets, marketId);
      market.totalUsdc -= payout;
      market.lastEventBlock = blockNumber;
      break;
    }
    case 'SurplusWithdrawn': {
      const recipient = (args.to as string | undefined)?.toLowerCase();
      const amount = coerceBigInt(args.amount);
      if (recipient) {
        const row = ensureTrader(traders, recipient, profiles);
        row.received += amount;
        row.surplus += amount;
      }
      break;
    }
    case 'MarketResolved': {
      const marketId = String(args.marketId);
      const market = ensureMarket(markets, marketId);
      market.resolved = true;
      market.surplusAccrued += coerceBigInt(args.surplus);
      market.lastEventBlock = blockNumber;
      break;
    }
    default:
      break;
  }
}

function handleVaultEvent(
  eventName: string,
  args: Record<string, unknown>,
  traders: Map<string, TraderStats>,
  profiles: Map<string, Profile>,
) {
  const addressKeys = ['locker', 'staker', 'user'];
  for (const key of addressKeys) {
    const value = args[key];
    if (typeof value === 'string') {
      ensureTrader(traders, value, profiles);
    }
  }
}

function handleRewardEvent(
  eventName: string,
  args: Record<string, unknown>,
  traders: Map<string, TraderStats>,
  profiles: Map<string, Profile>,
) {
  if (eventName !== 'RewardClaimed') return;
  const user = (args.user as string | undefined)?.toLowerCase();
  const amount = BigInt(args.amount as bigint);
  if (!user) return;
  const row = ensureTrader(traders, user, profiles);
  row.received += amount;
  row.rewards += amount;
}

function buildSummary(traders: Map<string, TraderStats>, markets: Map<string, MarketStats>) {
  const traderRows = Array.from(traders.values());
  const marketRows = Array.from(markets.values());

  for (const row of traderRows) {
    row.net = row.received - row.spent;
  }

  const totalVolume = traderRows.reduce((sum, row) => sum + row.volume, 0n);
  const totalSpent = traderRows.reduce((sum, row) => sum + row.spent, 0n);
  const totalReceived = traderRows.reduce((sum, row) => sum + row.received, 0n);
  const totalRewards = traderRows.reduce((sum, row) => sum + row.rewards, 0n);
  const totalTVL = marketRows.reduce((sum, row) => sum + (row.totalUsdc > 0n ? row.totalUsdc : 0n), 0n);

  const activeTraders = traderRows.filter((row) => row.trades > 0);

  const topVolume = [...activeTraders]
    .sort((a, b) => Number(b.volume - a.volume))
    .slice(0, 20)
    .map((row) => formatTrader(row));

  const topProfit = [...activeTraders]
    .sort((a, b) => Number(b.net - a.net))
    .slice(0, 20)
    .map((row) => formatTrader(row));

  const worstProfit = [...activeTraders]
    .sort((a, b) => Number(a.net - b.net))
    .slice(0, 20)
    .map((row) => formatTrader(row));

  const tvlByMarket = [...marketRows]
    .sort((a, b) => Number((b.totalUsdc > 0n ? b.totalUsdc : 0n) - (a.totalUsdc > 0n ? a.totalUsdc : 0n)))
    .slice(0, 20)
    .map((row) => ({
      marketId: row.marketId,
      creator: row.creator,
      oracle: row.oracle,
      totalUsdc: row.totalUsdc.toString(),
      totalUsdcUsd: toUsd(row.totalUsdc),
      tradedVolumeUsd: toUsd(row.tradedVolume),
      resolved: row.resolved,
      surplusAccrued: row.surplusAccrued.toString(),
    }));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      traders: traderRows.length,
      markets: marketRows.length,
      totalVolume: totalVolume.toString(),
      totalVolumeUsd: toUsd(totalVolume),
      totalSpent: totalSpent.toString(),
      totalReceived: totalReceived.toString(),
      totalRewards: totalRewards.toString(),
      totalTVL: totalTVL.toString(),
      totalTVLUsd: toUsd(totalTVL),
    },
    tvlByMarket,
    topVolume,
    topProfit,
    worstProfit,
  };
}

function formatTrader(row: TraderStats) {
  return {
    address: row.address,
    displayName: row.profile?.displayName ?? null,
    xHandle: row.profile?.xHandle ?? null,
    trades: row.trades,
    volume: row.volume.toString(),
    volumeUsd: toUsd(row.volume),
    spent: row.spent.toString(),
    received: row.received.toString(),
    rewards: row.rewards.toString(),
    net: row.net.toString(),
    netUsd: toUsd(row.net),
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
