import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/db";

const CHAIN_ID = 8453;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rangeParam = (searchParams.get("range") ?? "14d") as any;
  const bucketParam = (searchParams.get("by") ?? "total") as any;

  try {
    const rows = getLeaderboard(rangeParam, bucketParam).map((row) => ({
      addr: row.addr,
      name: row.name,
      xHandle: row.xHandle,
      reward: BigInt(Math.round(row.reward * 1_000_000)).toString(),
      rewardCreator: BigInt(Math.round(row.rewardCreator * 1_000_000)).toString(),
      rewardBooster: BigInt(Math.round(row.rewardBooster * 1_000_000)).toString(),
      rewardTrader: BigInt(Math.round(row.rewardTrader * 1_000_000)).toString(),
      efficiency: row.efficiency,
      marketsTouched: row.marketsTouched,
      recentRewardTs: row.recentRewardTs
    }));

    return NextResponse.json({ chainId: CHAIN_ID, range: rangeParam, bucket: bucketParam, rows });
  } catch (error) {
    return NextResponse.json({ chainId: CHAIN_ID, error: "failed_to_fetch" }, { status: 500 });
  }
}
