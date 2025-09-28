import { NextResponse } from "next/server";
import { getBoostLedger } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET(request: Request, { params }: { params: { address: string } }) {
  const addr = params.address?.trim();
  if (!addr) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "missing_address" }, { status: 400 });
  }
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit") ?? "40");
  try {
    const rows = getBoostLedger(addr, Number.isFinite(limit) ? limit : 40);
    return NextResponse.json({ chainId: CHAIN_ID, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
