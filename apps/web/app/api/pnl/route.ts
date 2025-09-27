import { NextResponse } from "next/server";
import { getPnl } from "@/lib/db";

const CHAIN_ID = 8453;

const toMicrosString = (value: number): string => {
  if (!Number.isFinite(value)) return "0";
  return BigInt(Math.round(value * 1_000_000)).toString();
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") ?? "14d") as any;
  try {
    const rows = getPnl(range).map((row) => ({
      addr: row.addr,
      name: row.name,
      xHandle: row.xHandle,
      reward: toMicrosString(row.reward),
      netFlow: toMicrosString(row.netFlow),
      pnl: toMicrosString(row.pnl)
    }));
    return NextResponse.json({ chainId: CHAIN_ID, range, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
