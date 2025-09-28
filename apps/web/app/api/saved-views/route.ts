import { NextResponse } from "next/server";
import { getSavedViews, upsertSavedView } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET() {
  try {
    const rows = getSavedViews();
    return NextResponse.json({ chainId: CHAIN_ID, rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}

function normalizeFilters(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function deriveViewId(requestedId: string | undefined, label: string | undefined): string {
  const fromRequest = requestedId?.trim();
  if (fromRequest) return fromRequest;
  if (label) {
    const slug = label
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (slug) return slug;
  }
  return `view-${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label : undefined;
    const query = typeof body.query === "string" ? body.query : undefined;
    const filters = normalizeFilters(body.filters);
    const id = deriveViewId(typeof body.id === "string" ? body.id : undefined, label);

    upsertSavedView(id, { label, query, filters: filters ?? null });
    const rows = getSavedViews();
    const saved = rows.find((row) => row.id === id);

    return NextResponse.json({ chainId: CHAIN_ID, view: saved ?? { id, label, query, filters } }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_save" }, { status: 500 });
  }
}
