import { getAbiStatus } from "@/lib/abiStatus";
import { getDb } from "@/lib/db";

export type HealthStatus = {
  abis: Record<string, boolean>;
  partial: boolean;
  lastBlocks: Record<string, number | null>;
  parityIssues: number;
  notes: string[];
};

const CONTRACT_NAMES: Record<string, string> = {
  predictionMarket: "PredictionMarket",
  vault: "Vault",
  rewardDistributor: "RewardDistributor"
};

const META_KEY = "indexer_last_block";

export function getHealthStatus(): HealthStatus {
  const db = getDb();
  const abiStatus = getAbiStatus();
  const abis: Record<string, boolean> = Object.fromEntries(
    Object.entries(abiStatus).map(([name, status]) => [name, status.ok])
  );

  const notes: string[] = [];
  for (const [name, status] of Object.entries(abiStatus)) {
    if (!status.ok) {
      notes.push(`${name} ABI missing: ${status.missing.join(", ")}`);
    }
  }

  const lastBlocks: Record<string, number | null> = {};
  const metaRow = db.prepare("SELECT value FROM indexer_meta WHERE key = ?").get(META_KEY) as { value?: string } | undefined;
  lastBlocks.overall = metaRow?.value ? Number(metaRow.value) : null;

  for (const [key, label] of Object.entries(CONTRACT_NAMES)) {
    const row = db.prepare("SELECT value FROM indexer_meta WHERE key = ?").get(`last_block:${key}`) as { value?: string } | undefined;
    lastBlocks[label] = row?.value ? Number(row.value) : null;
  }

  const parityRow = db.prepare("SELECT COUNT(*) AS count FROM parity_issues").get() as { count: number };
  const parityIssues = parityRow?.count ?? 0;
  if (parityIssues > 0) {
    notes.push(`${parityIssues} parity issues detected`);
  }

  const partial =
    Object.values(abis).some((ok) => !ok) ||
    lastBlocks.overall === null ||
    Object.entries(CONTRACT_NAMES).some(([key, label]) => lastBlocks[label] === null) ||
    parityIssues > 0;

  return {
    abis,
    partial,
    lastBlocks,
    parityIssues,
    notes
  };
}
