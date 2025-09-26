import { NextResponse } from "next/server";
import { getPnl } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") ?? "14d") as any;
  try {
    const rows = getPnl(range);
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}
