import "dotenv/config";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
}

export const env = {
  baseRpc: requireEnv("BASE_RPC"),
  predictionMarket: requireEnv("PREDICTION_MARKET").toLowerCase(),
  vault: requireEnv("VAULT").toLowerCase(),
  rewardDistributor: requireEnv("REWARD_DISTRIBUTOR").toLowerCase(),
  usdc: requireEnv("USDC").toLowerCase(),
  databasePath: requireEnv("DATABASE_PATH"),
  lookbackDays: Number(process.env.LOOKBACK_DAYS ?? "14")
} as const;
