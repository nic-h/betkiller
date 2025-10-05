import fs from "node:fs";
import { abiPath } from "@/lib/abiPaths";

type Requirement = string | string[];

type Status = {
  ok: boolean;
  missing: string[];
};

const REQUIRED_EVENTS: Record<string, Requirement[]> = {
  Vault: [["LockUpdated"], ["Unlocked"], ["SponsoredLocked"]],
  PredictionMarket: [["MarketTraded"], ["TokensRedeemed"], ["MarketResolved"]],
  RewardDistributor: [["RewardClaimed"]],
  OutcomeTokenImpl: []
};

function loadAbi(name: string): any[] {
  const resolved = abiPath(name);
  if (!resolved) throw new Error("missing ABI");
  const contents = fs.readFileSync(resolved, "utf8");
  return JSON.parse(contents);
}

function checkAbi(name: string, requirements: Requirement[]): Status {
  try {
    const abi = loadAbi(name);
    const events = new Set(
      abi
        .filter((item: any) => item?.type === "event" && typeof item?.name === "string")
        .map((item: any) => item.name)
    );
    const missing: string[] = [];
    for (const requirement of requirements) {
      if (Array.isArray(requirement)) {
        const satisfied = requirement.some((candidate) => events.has(candidate));
        if (!satisfied) missing.push(requirement.join(" | "));
      } else if (!events.has(requirement)) {
        missing.push(requirement);
      }
    }
    return { ok: missing.length === 0, missing };
  } catch (error) {
    return { ok: false, missing: ["failed to load"] };
  }
}

export function getAbiStatus() {
  const result: Record<string, Status> = {};
  for (const [name, requirements] of Object.entries(REQUIRED_EVENTS)) {
    result[name] = checkAbi(name, requirements);
  }
  return result;
}
