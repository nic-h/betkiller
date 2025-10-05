import type { NextApiRequest, NextApiResponse } from "next";
import { getDb } from "@/lib/db";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, category, reference, expected_fp, actual_fp, diff_fp, ts
       FROM parity_issues
       ORDER BY ts DESC
       LIMIT 200`
    )
    .all()
    .map((row: any) => ({
      id: row.id,
      category: row.category,
      reference: row.reference,
      expected_fp: row.expected_fp,
      actual_fp: row.actual_fp,
      diff_fp: row.diff_fp,
      ts: row.ts
    }));

  res.status(200).json({ count: rows.length, rows });
}
