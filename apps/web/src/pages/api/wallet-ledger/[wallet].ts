import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getWalletEventLog } from "@/lib/events";

const walletParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }

  const walletResult = walletParam.safeParse(req.query.wallet);
  if (!walletResult.success) {
    res.status(400).json({ error: "Invalid wallet" });
    return;
  }

  const limitParam = Number.parseInt(String(req.query.limit ?? "100"), 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 100;

  try {
    const events = getWalletEventLog(walletResult.data, limit);
    res.status(200).json({ events });
  } catch (error) {
    res.status(500).json({ error: "Failed to load event log" });
  }
}
