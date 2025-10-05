import { NextResponse } from "next/server";

import { getLeaderboard } from "@/lib/db";
import { normalizeRange } from "@/lib/range";

const CHAIN_ID = 8453;

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range"));
  try {
    const rows = getLeaderboard(range);
    return NextResponse.json({ chainId: CHAIN_ID, range, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
