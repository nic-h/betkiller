import fs from "fs";
import path from "path";
import type { Abi } from "viem";

function loadAbi(name: string): Abi {
  const artifactsDir = path.resolve(process.cwd(), "abis");
  const filePath = path.join(artifactsDir, `${name}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`ABI file missing: ${filePath}`);
  }
  const json = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!json.abi) {
    throw new Error(`ABI payload missing for ${name}`);
  }
  return json.abi as Abi;
}

export const predictionMarketAbi = loadAbi("PredictionMarket");
export const vaultAbi = loadAbi("Vault");
export const rewardDistributorAbi = loadAbi("RewardDistributor");
export const erc20Abi = loadAbi("IERC20");
