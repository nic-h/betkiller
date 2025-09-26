import { NextResponse } from "next/server";
import { loadRewardEvents } from "@/lib/queries";

export async function GET() {
  try {
    const events = loadRewardEvents();
    return NextResponse.json({ events });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "failed to load rewards" }, { status: 500 });
  }
}
