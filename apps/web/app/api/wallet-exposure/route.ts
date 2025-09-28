import { NextResponse } from "next/server";
import { getWalletExposure } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET() {
  try {
    const rows = getWalletExposure();
    return NextResponse.json({ chainId: CHAIN_ID, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
