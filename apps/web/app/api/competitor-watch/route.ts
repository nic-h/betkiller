import { NextResponse } from "next/server";
import { getCompetitorWatch } from "@/lib/db";

export async function GET() {
  try {
    const entries = getCompetitorWatch();
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}
