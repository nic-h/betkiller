import { NextResponse } from "next/server";
import { loadVaultEvents } from "@/lib/queries";

export async function GET() {
  try {
    const events = loadVaultEvents();
    return NextResponse.json({ events });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "failed to load boosts" }, { status: 500 });
  }
}
