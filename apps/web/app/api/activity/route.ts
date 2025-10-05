import { NextResponse } from "next/server";

import { getRecentActivity } from "@/lib/db";
import { normalizeRange } from "@/lib/range";

const CHAIN_ID = 8453;

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range"));
  const limit = Number(searchParams.get("limit") ?? 20);
  try {
    const rows = getRecentActivity(range, limit);
    return NextResponse.json({ chainId: CHAIN_ID, range, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
