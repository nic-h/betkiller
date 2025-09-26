import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") ?? "14d") as any;
  const bucket = (searchParams.get("by") ?? "total") as any;

  try {
    const rows = getLeaderboard(range, bucket);
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}
