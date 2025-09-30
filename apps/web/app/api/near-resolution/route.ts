import { NextResponse } from "next/server";
import { getNearResolution } from "@/lib/db";
import { ensureRange } from "@/lib/range";

const CHAIN_ID = 8453;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = ensureRange(searchParams.get("range"));
  try {
    const rows = getNearResolution(range);
    return NextResponse.json({ chainId: CHAIN_ID, range, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
