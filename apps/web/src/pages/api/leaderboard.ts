import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

const COLUMNS = new Set([
  "epv_fp",
  "cash_fp",
  "claims_fp",
  "boosts_fp",
  "win_loss_fp",
  "total_buys_fp",
  "rewards_fp",
  "winnings_fp",
  "refunds_fp"
]);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const column = typeof req.query.by === "string" && COLUMNS.has(req.query.by) ? (req.query.by as string) : "epv_fp";
  const direction = req.query.dir === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Number.parseInt(String(req.query.limit ?? "100"), 10) || 100, 200);
  const offset = Number.parseInt(String(req.query.offset ?? "0"), 10) || 0;

  const db = getDb();
  const rows = db
    .prepare(
      `SELECT user, epv_fp, cash_fp, claims_fp, boosts_fp, win_loss_fp, total_buys_fp, rewards_fp, winnings_fp, refunds_fp, updated_ts
       FROM wallet_stats
       ORDER BY ${column} ${direction}
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  res.status(200).json({ rows });
}
