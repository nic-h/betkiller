import { NextResponse } from "next/server";

import { getLeaderboard } from "@/lib/db";
import { ensureRange } from "@/lib/range";
import type { LeaderboardBucket } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = ensureRange(searchParams.get("range"));
  const bucket = normalizeBucket(searchParams.get("by"));

  try {
    const rows = getLeaderboard(range, bucket);
    return NextResponse.json({ chainId: CHAIN_ID, range, bucket, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}

function normalizeBucket(value: string | null): LeaderboardBucket {
  switch ((value ?? "total").toLowerCase()) {
    case "creator":
      return "creator";
    case "booster":
      return "booster";
    case "trader":
      return "trader";
    case "eff":
    case "efficiency":
      return "efficiency";
    default:
      return "total";
  }
}
