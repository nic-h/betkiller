import { NextResponse } from "next/server";

const CHAIN_ID = 8453;

function getProviderBase(): string | null {
  const base = process.env.REWARDS_PROVIDER_BASE_URL?.trim();
  if (!base) return null;
  return base.replace(/\/$/, "");
}

export async function POST(request: Request, { params }: { params: { address: string } }) {
  const base = getProviderBase();
  if (!base) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "provider_unavailable" }, { status: 503 });
  }

  const address = params.address?.trim()?.toLowerCase();
  if (!address) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "missing_address" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "invalid_body" }, { status: 400 });
  }

  const epochIds = Array.isArray((body as any)?.epochIds) ? ((body as any).epochIds as unknown[]) : [];
  const uniqueEpochs = Array.from(
    new Set(
      epochIds
        .map((value) => Number(value))
        .filter((value): value is number => Number.isFinite(value) && value > 0)
    )
  );
  if (uniqueEpochs.length === 0) {
    return NextResponse.json({ chainId: CHAIN_ID, proofs: [] });
  }

  try {
    const res = await fetch(`${base}/proofs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ address, epochIds: uniqueEpochs })
    });
    if (!res.ok) {
      return NextResponse.json({ chainId: CHAIN_ID, error: "provider_failed" }, { status: 502 });
    }
    const payload = (await res.json()) as {
      proofs?: Array<{ epochId?: number; amount?: string | number; proof?: string[] }>;
    };
    const proofs = Array.isArray(payload?.proofs)
      ? payload.proofs
          .map((entry) => ({
            epochId: Number(entry.epochId ?? 0),
            amount: String(entry.amount ?? "0"),
            proof: Array.isArray(entry.proof) ? entry.proof : []
          }))
          .filter((entry) => Number.isFinite(entry.epochId) && entry.epochId > 0)
      : [];
    return NextResponse.json({ chainId: CHAIN_ID, proofs });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "provider_error" }, { status: 500 });
  }
}
