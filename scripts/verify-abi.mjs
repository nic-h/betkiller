import fs from "node:fs";
import path from "node:path";

const REQUIRED_EVENTS = {
  Vault: [["LockUpdated"], ["Unlocked"], ["SponsoredLocked"]],
  PredictionMarket: [
    ["MarketTraded"],
    ["TokensRedeemed"],
    ["MarketResolved"]
  ],
  RewardDistributor: [["RewardClaimed"]],
  // OutcomeTokenImpl optional
};

function loadAbi(name) {
  const filePath = path.join(process.cwd(), "apps", "web", "src", "abi", `${name}.json`);
  const contents = fs.readFileSync(filePath, "utf8");
  return JSON.parse(contents);
}

function ensureEvents(name, expectations) {
  const abi = loadAbi(name);
  const events = new Set(
    abi
      .filter((item) => item.type === "event" && typeof item.name === "string")
      .map((item) => item.name)
  );

  const missing = [];

  for (const expectation of expectations) {
    if (Array.isArray(expectation)) {
      const anyMatch = expectation.some((candidate) => events.has(candidate));
      if (!anyMatch) {
        missing.push(expectation.join(" | "));
      }
    } else if (!events.has(expectation)) {
      missing.push(expectation);
    }
  }
  if (missing.length) {
    throw new Error(`${name} ABI missing events: ${missing.join(", ")}`);
  }

  console.log(`✓ ${name} ABI OK`);
}

for (const [name, expectations] of Object.entries(REQUIRED_EVENTS)) {
  ensureEvents(name, expectations);
}

console.log("All ABIs verified");
