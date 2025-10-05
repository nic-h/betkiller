import fs from "fs";
import os from "os";
import path from "path";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resetDatabaseConnection } from "@/lib/database";

let tempDir = "";
let dbPath = "";
let getLeaderboard: (range: "24h" | "1w" | "1m") => any[];
let getMarketSummaries: (range: "24h" | "1w" | "1m", limit?: number, index?: Map<string, any>) => any[];

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ctxdash-test-"));
  dbPath = path.join(tempDir, "context.db");

  const db = new Database(dbPath, { readonly: false });

  db.exec(`
    CREATE TABLE trades (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      marketId TEXT NOT NULL,
      txHash TEXT NOT NULL,
      usdcIn TEXT NOT NULL,
      usdcOut TEXT NOT NULL,
      trader TEXT,
      logIndex INTEGER,
      blockNumber TEXT
    );
    CREATE TABLE rewards (
      id INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      epochId TEXT,
      user TEXT,
      amount TEXT,
      root TEXT
    );
    CREATE TABLE markets (
      marketId TEXT PRIMARY KEY,
      metadata TEXT,
      outcomeNames TEXT,
      oracle TEXT,
      surplusRecipient TEXT,
      questionId TEXT,
      createdAt INTEGER
    );
    CREATE TABLE locks (
      id INTEGER PRIMARY KEY,
      ts INTEGER,
      marketId TEXT,
      user TEXT,
      type TEXT,
      payloadJson TEXT
    );
    CREATE TABLE market_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketId TEXT,
      ts INTEGER,
      totalUsdc TEXT,
      totalQ TEXT,
      alpha TEXT
    );
    CREATE TABLE prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      marketId TEXT,
      ts INTEGER,
      pricesJson TEXT
    );
    CREATE TABLE profiles (
      address TEXT PRIMARY KEY,
      display_name TEXT,
      x_handle TEXT
    );
  `);

  const now = Math.floor(Date.now() / 1000);
  const recent = now - 600;

  const addrA = "0x1111111111111111111111111111111111111111";
  const addrB = "0x2222222222222222222222222222222222222222";
  const addrC = "0x3333333333333333333333333333333333333333";

  db.prepare(
    `INSERT INTO trades (ts, marketId, txHash, usdcIn, usdcOut, trader, logIndex, blockNumber)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(recent, "0xmarket1", "tx-a", "200000000", "50000000", addrA, 0, "1");

  db.prepare(
    `INSERT INTO trades (ts, marketId, txHash, usdcIn, usdcOut, trader, logIndex, blockNumber)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(recent, "0xmarket1", "tx-b", "60000000", "10000000", addrB, 1, "2");

  db.prepare(
    `INSERT INTO trades (ts, marketId, txHash, usdcIn, usdcOut, trader, logIndex, blockNumber)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(recent, "0xmarket1", "tx-c", "20000000", "90000000", addrC, 2, "3");

  db.prepare(
    `INSERT INTO rewards (ts, kind, epochId, user, amount, root)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(recent, "claimable", null, addrA, "300000000", null);

  db.prepare(
    `INSERT INTO rewards (ts, kind, epochId, user, amount, root)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(recent, "claimable", null, addrB, "60000000", null);

  db.prepare(
    `INSERT INTO markets (marketId, metadata, outcomeNames, oracle, surplusRecipient, questionId, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "0xmarket1",
    JSON.stringify({ title: "Test market", category: "Sports", close: recent + 3600 }),
    JSON.stringify(["Yes", "No"]),
    "0xoracle",
    "0xsurplus",
    "q1",
    recent - 3600
  );

  db.prepare(
    `INSERT INTO locks (ts, marketId, user, type, payloadJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(recent - 100, "0xmarket1", addrA, "sponsored", JSON.stringify({ actualCost: "90000000" }));

  db.prepare(
    `INSERT INTO locks (ts, marketId, user, type, payloadJson)
     VALUES (?, ?, ?, ?, ?)`
  ).run(recent - 50, "0xmarket1", addrA, "unlock", JSON.stringify({ amounts: ["10000000"] }));

  db.prepare(
    `INSERT INTO market_state (marketId, ts, totalUsdc, totalQ, alpha)
     VALUES (?, ?, ?, ?, ?)`
  ).run("0xmarket1", recent, "500000000", "0", "0");

  const priceStmt = db.prepare(
    `INSERT INTO prices (marketId, ts, pricesJson)
     VALUES (?, ?, ?)`
  );
  priceStmt.run("0xmarket1", recent - 120, JSON.stringify([0.55]));
  priceStmt.run("0xmarket1", recent - 60, JSON.stringify([0.65]));

  const profileStmt = db.prepare(
    `INSERT INTO profiles (address, display_name, x_handle)
     VALUES (?, ?, ?)`
  );
  profileStmt.run(addrA, "Alpha", "alpha" );
  profileStmt.run(addrB, "Beta", "beta");
  profileStmt.run(addrC, "Gamma", "gamma");

  db.close();

  process.env.SQLITE_PATH = dbPath;
  delete process.env.BK_DB;
  delete process.env.DATABASE_PATH;
  delete process.env.BK_ME;

  resetDatabaseConnection();

  return import("@/lib/db").then((mod) => {
    getLeaderboard = mod.getLeaderboard;
    getMarketSummaries = mod.getMarketSummaries;
  });
});

afterAll(() => {
  resetDatabaseConnection();
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("dashboard data layer", () => {
  it("computes ROI-weighted leaderboard rows", () => {
    const rows = getLeaderboard("24h");
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const top = rows[0];
    expect(top.addr).toBe("0x1111111111111111111111111111111111111111");
    expect(top.name).toBe("Alpha");
    expect(top.capitalAtRisk).toBeCloseTo(150, 2);
    expect(top.rewards).toBeCloseTo(300, 2);
    expect(top.netProfit).toBeCloseTo(150, 2);
    expect(top.roiPercent).toBeCloseTo(100, 2);
    expect(top.weightedScore).toBeCloseTo(217.9, 1);
    expect(top.roiRank).toBe(1);
  });

  it("extracts biggest YES/NO holders per market", () => {
    const leaderboardIndex = new Map(getLeaderboard("24h").map((entry) => [entry.addr, entry]));
    const markets = getMarketSummaries("24h", 5, leaderboardIndex);
    expect(markets.length).toBeGreaterThan(0);

    const market = markets[0];
    expect(market.marketId).toBe("0xmarket1");
    expect(market.boostLocked).toBeCloseTo(80, 2); // 90 sponsored - 10 unlocked
    expect(market.biggestYes?.addr).toBe("0x1111111111111111111111111111111111111111");
    expect(market.biggestYes?.netExposure).toBeCloseTo(150, 2);
    expect(market.biggestYes?.roiRank).toBe(1);

    expect(market.biggestNo?.addr).toBe("0x3333333333333333333333333333333333333333");
    expect(market.biggestNo?.netExposure).toBeCloseTo(70, 2);
  });
});
