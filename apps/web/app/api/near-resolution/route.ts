import { NextResponse } from "next/server";
import { getNearResolution } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET() {
  try {
    const rows = getNearResolution();
    return NextResponse.json({ chainId: CHAIN_ID, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
