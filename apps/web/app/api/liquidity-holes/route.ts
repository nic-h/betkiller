import { NextResponse } from "next/server";
import { getLiquidityHoles } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET() {
  try {
    const rows = getLiquidityHoles();
    return NextResponse.json({ chainId: CHAIN_ID, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
