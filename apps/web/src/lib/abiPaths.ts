import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const validNames = new Set(["Vault", "PredictionMarket", "RewardDistributor", "OutcomeTokenImpl"]);

function resolveLocal(name: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "abi", `${name}.json`);
}

function resolveWorkspace(name: string) {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "..", "src", "abi", `${name}.json`);
}

export function abiPath(name: string): string | null {
  if (!validNames.has(name)) return null;
  const local = resolveLocal(name);
  if (existsSync(local)) return local;
  const root = resolveWorkspace(name);
  if (existsSync(root)) return root;
  return null;
}
