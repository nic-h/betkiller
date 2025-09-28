import { NextResponse } from "next/server";
import { deleteSavedView, getSavedViews, upsertSavedView } from "@/lib/db";

const CHAIN_ID = 8453;

function normalizeFilters(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "missing_id" }, { status: 400 });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const label = typeof body.label === "string" ? body.label : undefined;
    const query = typeof body.query === "string" ? body.query : undefined;
    const filters = normalizeFilters(body.filters);
    upsertSavedView(id, { label, query, filters: filters ?? null });
    const rows = getSavedViews();
    const saved = rows.find((row) => row.id === id);
    return NextResponse.json({ chainId: CHAIN_ID, view: saved ?? { id, label, query, filters } });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_save" }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "missing_id" }, { status: 400 });
  }
  try {
    deleteSavedView(id);
    return NextResponse.json({ chainId: CHAIN_ID, ok: true });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_delete" }, { status: 500 });
  }
}
