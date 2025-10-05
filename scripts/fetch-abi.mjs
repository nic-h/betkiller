import fs from "node:fs/promises";
import path from "node:path";

const ADDRESSES = {
  PredictionMarket: "0x000000000000ce50e1e1f6f99b2e5e98e5b6c609",
  OutcomeTokenImpl: "0x70674ca9e35cca4e12926357ed763844d276532c",
  Vault: "0xe8e5dc8c7c8fd6bfce5e614e02f42e9cf8b72276",
  RewardDistributor: "0xc1dd1ea5b7a3e84c3ebadcc6a4f13a0f432e78a2"
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJSON(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" }
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function parseAbi(result) {
  if (!result) return null;
  const text = typeof result === "string" ? result : JSON.stringify(result);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("ABI payload is not an array");
  }
  return parsed;
}

async function fetchAbi(address) {
  const addr = address.toLowerCase();
  const etherscanKey = process.env.ETHERSCAN_KEY;
  const basescanKey = process.env.BASESCAN_KEY ?? "";

  if (etherscanKey) {
    try {
      const data = await fetchJSON(
        `https://api.etherscan.io/v2/api?chainid=8453&module=contract&action=getabi&address=${addr}&apikey=${etherscanKey}`
      );
      if (data.status === "1" && data.result) {
        return parseAbi(data.result);
      }
      if (data.message) {
        console.warn(`Etherscan message for ${addr}: ${data.message}`);
      }
    } catch (error) {
      console.warn(`Etherscan fetch failed for ${addr}:`, error instanceof Error ? error.message : error);
    }
  }

  try {
    await sleep(150);
    const data = await fetchJSON(
      `https://api.basescan.org/api?module=contract&action=getabi&address=${addr}&apikey=${basescanKey}`
    );
    if (data.status === "1" && data.result) {
      return parseAbi(data.result);
    }
    if (data.message) {
      console.warn(`BaseScan message for ${addr}: ${data.message}`);
    }
  } catch (error) {
    console.warn(`BaseScan fetch failed for ${addr}:`, error instanceof Error ? error.message : error);
  }

  for (const tier of ["full_match", "partial_match"]) {
    try {
      await sleep(150);
      const data = await fetchJSON(
        `https://repo.sourcify.dev/contracts/${tier}/8453/${addr}/metadata.json`
      );
      if (data?.output?.abi) {
        return parseAbi(data.output.abi);
      }
    } catch (error) {
      // ignore and try next tier
    }
  }

  throw new Error(`ABI not found for ${address}`);
}

async function main() {
  await loadEnv();
  const targetDir = path.join(process.cwd(), "apps", "web", "src", "abi");
  const rootDir = path.join(process.cwd(), "src", "abi");
  await fs.mkdir(targetDir, { recursive: true });
  await fs.mkdir(rootDir, { recursive: true });

  for (const [name, addr] of Object.entries(ADDRESSES)) {
    const abi = await fetchAbi(addr);
    const payload = JSON.stringify(abi, null, 2);
    await fs.writeFile(path.join(targetDir, `${name}.json`), payload);
    await fs.writeFile(path.join(rootDir, `${name}.json`), payload);
    console.log(`✓ ${name} ABI saved`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

async function loadEnv() {
  const locations = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "apps", "web", ".env.local"),
    path.join(process.cwd(), "apps", "web", ".env.private")
  ];

  for (const file of locations) {
    try {
      const content = await fs.readFile(file, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const value = trimmed.slice(idx + 1).trim();
        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      // ignore missing files
    }
  }
}
