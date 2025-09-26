import { NextResponse } from "next/server";
import { getMySummary } from "@/lib/db";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const range = (searchParams.get("range") ?? "14d") as any;
  try {
    const splits = getMySummary(range);
    return NextResponse.json({ splits });
  } catch (error) {
    return NextResponse.json({ error: "failed_to_fetch" }, { status: 500 });
  }
}
