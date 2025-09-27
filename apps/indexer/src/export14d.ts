import fs from "node:fs";
import path from "node:path";
import { db } from "./db.js";

const days = Math.max(1, Number(process.env.RETENTION_DAYS ?? process.env.BACKFILL_DAYS ?? 14));
const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

const snapshot = {
  markets: db
    .prepare(
      `SELECT * FROM markets WHERE createdAt IS NULL OR createdAt >= ?`
    )
    .all(cutoff),
  trades: db.prepare(`SELECT * FROM trades WHERE ts >= ?`).all(cutoff),
  locks: db.prepare(`SELECT * FROM locks WHERE ts >= ?`).all(cutoff),
  rewards: db.prepare(`SELECT * FROM rewards WHERE ts >= ?`).all(cutoff),
  reward_claims: db.prepare(`SELECT * FROM reward_claims WHERE ts >= ?`).all(cutoff),
  meta: {
    exportedAt: new Date().toISOString(),
    chainId: 8453,
    windowDays: days
  }
};

const outDir = path.resolve("apps/web/public/snapshots");
fs.mkdirSync(outDir, { recursive: true });
const fileName = `context-14d-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const fullPath = path.join(outDir, fileName);
fs.writeFileSync(fullPath, JSON.stringify(snapshot, null, 2));

console.log(JSON.stringify({ wrote: fullPath, cutoff, days }, null, 2));
