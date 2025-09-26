import { NextResponse } from "next/server";
import { loadMarkets } from "@/lib/queries";

export async function GET() {
  try {
    const markets = loadMarkets();
    return NextResponse.json({ markets });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "failed to load markets" }, { status: 500 });
  }
}
