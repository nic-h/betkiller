import { NextResponse } from "next/server";
import { getLiveSlate } from "@/lib/db";

export async function GET() {
  try {
    const rows = getLiveSlate();
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}
