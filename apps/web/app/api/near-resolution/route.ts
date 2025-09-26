import { NextResponse } from "next/server";
import { getNearResolution } from "@/lib/db";

export async function GET() {
  try {
    const items = getNearResolution();
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}
