import type { NextApiRequest, NextApiResponse } from "next";
import { getNearResolutionMarkets } from "@/lib/nearResolution";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const limit = Math.min(Number.parseInt(String(req.query.limit ?? "6"), 10) || 6, 20);
  const markets = await getNearResolutionMarkets(limit);
  res.status(200).json({ markets });
}
