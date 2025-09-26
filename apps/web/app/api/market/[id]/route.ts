import { NextResponse } from "next/server";
import { loadMarketDetail } from "@/lib/queries";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    const data = loadMarketDetail(params.id);
    if (!data) {
      return NextResponse.json({ error: "market not found" }, { status: 404 });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "failed to load market" }, { status: 500 });
  }
}
