import { NextResponse } from "next/server";
import { getNearResolution } from "@/lib/db";

export async function GET() {
  try {
    const rows = getNearResolution();
    return NextResponse.json({ rows });
  } catch (error) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}
