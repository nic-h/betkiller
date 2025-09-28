import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

function optionalList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const rpcList = optionalList(process.env.RPC_URLS ?? process.env.RPC_URL);

const fallbackBaseRpc = process.env.BASE_RPC ?? process.env.BASE_RPC_URL ?? rpcList[0];
if (!fallbackBaseRpc) {
  throw new Error("Missing required RPC configuration. Provide BASE_RPC or RPC_URLS.");
}

const rewardDistributorEnv = requireEnv("REWARD_DISTRIBUTOR").toLowerCase();
const rewardDistributorsList = optionalList(process.env.REWARD_DISTRIBUTORS).map((entry) => entry.toLowerCase());
const rewardDistributors = rewardDistributorsList.length > 0 ? rewardDistributorsList : [rewardDistributorEnv];
const rewardToken = (process.env.REWARD_TOKEN ?? process.env.USDC) as string | undefined;
if (!rewardToken) {
  throw new Error("Missing REWARD_TOKEN or USDC for reward tracking");
}

export const env = {
  baseRpc: fallbackBaseRpc,
  rpcUrls: rpcList.length > 0 ? rpcList : [fallbackBaseRpc],
  predictionMarket: requireEnv("PREDICTION_MARKET").toLowerCase(),
  vault: requireEnv("VAULT").toLowerCase(),
  rewardDistributor: rewardDistributorEnv,
  rewardDistributors,
  rewardToken: rewardToken.toLowerCase(),
  usdc: requireEnv("USDC").toLowerCase(),
  databasePath: requireEnv("DATABASE_PATH"),
  lookbackDays: Number(process.env.LOOKBACK_DAYS ?? "14"),
  logInitSpan: Number(process.env.LOG_INIT_SPAN ?? "800"),
  logMaxSpan: Number(process.env.LOG_MAX_SPAN ?? "2400"),
  logMinSpan: Number(process.env.LOG_MIN_SPAN ?? "100"),
  rpcQps: Number(process.env.RPC_QPS ?? "2"),
  rpcTimeoutMs: Number(process.env.RPC_TIMEOUT_MS ?? "15000"),
  rpcMaxRetries: Number(process.env.RPC_MAX_RETRIES ?? process.env.RPC_MAX_ATTEMPTS ?? "7"),
  mentionFeedUrl: process.env.MENTION_FEED_URL?.trim() ?? "",
  mentionFetchIntervalMs: Number(process.env.MENTION_FETCH_INTERVAL_MS ?? "300000")
} as const;
