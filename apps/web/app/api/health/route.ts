import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const database = db();
  const lastBlockRow = database
    .prepare("SELECT value FROM meta WHERE key='lastBlock'")
    .get() as { value?: string } | undefined;
  const updatedRow = database
    .prepare("SELECT value FROM meta WHERE key='lastUpdatedAt'")
    .get() as { value?: string } | undefined;

  return NextResponse.json({
    lastBlock: lastBlockRow?.value ? Number(lastBlockRow.value) : 0,
    updatedAt: updatedRow?.value ? Number(updatedRow.value) : 0
  });
}
