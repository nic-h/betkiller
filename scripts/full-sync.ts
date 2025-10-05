import fs from "node:fs/promises";
import path from "node:path";
import { scanRange, createIndexerClient, getLastProcessed, setLastProcessed } from "../apps/web/src/indexer/scan";
import { getDb } from "../apps/web/src/lib/db";

const CHUNK = BigInt(process.env.SYNC_CHUNK ?? "9");

async function main() {
  await loadEnv();
  const client = createIndexerClient();
  const db = getDb();
  const latest = process.env.SYNC_END ? BigInt(process.env.SYNC_END) : await client.getBlockNumber();
  const startOverride = process.env.SYNC_START ? BigInt(process.env.SYNC_START) : null;
  let last = getLastProcessed(db);
  let from = startOverride ?? (last !== null ? BigInt(last + 1) : 0n);

  while (from <= latest) {
    const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
    console.log(`Syncing blocks ${from} -> ${to}`);
    await scanRange(client, db, from, to);
    setLastProcessed(db, Number(to));
    from = to + 1n;
  }

  console.log(`Sync complete up to block ${latest}`);
}

main().catch((error) => {
  console.error(error);
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
