import { NextRequest, NextResponse } from "next/server";
import { searchContextEntities } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q")?.trim() ?? "";
    if (!query) {
      return NextResponse.json({ chainId: CHAIN_ID, rows: [] });
    }
    const rows = searchContextEntities(query, 20);
    return NextResponse.json({ chainId: CHAIN_ID, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_search" }, { status: 500 });
  }
}
