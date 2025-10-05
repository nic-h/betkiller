import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getWalletStats } from "@/lib/walletStats";

const walletParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());

type WalletStatsResponse = Awaited<ReturnType<typeof getWalletStats>>;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }

  const parseResult = walletParam.safeParse(req.query.wallet);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid wallet" });
    return;
  }

  const wallet = parseResult.data;

  try {
    const stats: WalletStatsResponse = await getWalletStats(wallet);
    res.status(200).json(stats);
  } catch (error) {
    res.status(500).json({ error: "Failed to compute wallet stats" });
  }
}
