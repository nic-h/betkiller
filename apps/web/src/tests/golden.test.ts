import { describe, it, expect, beforeAll } from "vitest";
import { getHealthStatus } from "@/lib/health";
import { computeWalletStatsFP } from "@/lib/walletStats";
import golden from "./golden.json";
import fs from "node:fs/promises";
import path from "node:path";

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

let healthOk = false;

beforeAll(async () => {
  await loadEnv();
  const health = getHealthStatus();
  healthOk = !health.partial;
  if (!healthOk) {
    console.warn("Skipping golden parity tests due to partial health", health.notes);
  }
});

describe("golden parity", () => {
  for (const wallet of golden.wallets) {
    const name = `wallet ${wallet.addr}`;
    it(name, async () => {
      if (!healthOk) {
        return;
      }
      const totals = await computeWalletStatsFP(wallet.addr);
      expect(totals.cash.toString()).toBe(wallet.expect.cash_fp);
      expect(totals.claims.toString()).toBe(wallet.expect.claims_fp);
      expect(totals.boosts.toString()).toBe(wallet.expect.boosts_fp);
      expect(totals.totalBuys.toString()).toBe(wallet.expect.total_buys_fp);
      expect(totals.winnings.toString()).toBe(wallet.expect.winnings_fp);
      expect(totals.rewards.toString()).toBe(wallet.expect.rewards_fp);
      expect(totals.refunds.toString()).toBe(wallet.expect.refunds_fp);
      expect(totals.winLoss.toString()).toBe(wallet.expect.win_loss_fp);
      expect(totals.epv.toString()).toBe(wallet.expect.epv_fp);
    });
  }
});
