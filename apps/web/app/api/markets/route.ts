import { NextResponse } from "next/server";
import { getMarketsTable } from "@/lib/db";
import { ensureRange } from "@/lib/range";

const CHAIN_ID = 8453;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = ensureRange(searchParams.get("range"));
  const limit = Number(searchParams.get("limit") ?? 200);

  try {
    const rows = getMarketsTable(range, limit);
    return NextResponse.json({ chainId: CHAIN_ID, range, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
