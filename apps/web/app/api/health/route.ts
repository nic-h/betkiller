import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET() {
  const database = db();
  const now = Math.floor(Date.now() / 1000);

  const cursorRow = database
    .prepare("SELECT last_block AS lastBlock, last_ts AS lastTs FROM indexer_cursor WHERE chain_id = ?")
    .get(CHAIN_ID) as { lastBlock?: number; lastTs?: number } | undefined;

  const metaRow = database
    .prepare(
      `SELECT seed_from_block AS seedFromBlock,
              seed_from_ts AS seedFromTs,
              seed_window_days AS seedWindowDays,
              seed_completed AS seedCompleted,
              updated_at AS updatedAt
       FROM indexer_meta
       WHERE chain_id = ?`
    )
    .get(CHAIN_ID) as {
      seedFromBlock?: number | null;
      seedFromTs?: number | null;
      seedWindowDays?: number | null;
      seedCompleted?: number | null;
      updatedAt?: number | null;
    } | undefined;

  const lastTs = cursorRow?.lastTs ?? 0;
  const minutesAgo = lastTs ? Math.max(0, (now - Number(lastTs)) / 60) : null;

  return NextResponse.json({
    chainId: CHAIN_ID,
    lastBlock: cursorRow?.lastBlock ?? 0,
    lastTs,
    lastUpdatedAt: lastTs,
    minutesAgo,
    seedMeta: {
      seedFromBlock: metaRow?.seedFromBlock ?? null,
      seedFromTs: metaRow?.seedFromTs ?? null,
      seedWindowDays: metaRow?.seedWindowDays ?? null,
      seedCompleted: metaRow?.seedCompleted ?? null,
      updatedAt: metaRow?.updatedAt ?? null
    }
  });
}
