import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getWalletEvents } from "@/lib/events";
import { normalizeRange, type TimeRangeKey } from "@/lib/timeRange";

const walletParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());

const rangeSchema = z.union([z.literal("24h"), z.literal("7d"), z.literal("30d")]);

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

  const rangeValue = rangeSchema.safeParse(req.query.range ?? "24h");
  const range: TimeRangeKey = rangeValue.success ? rangeValue.data : normalizeRange(req.query.range);

  try {
    const events = getWalletEvents(walletResult.data, range, 30);
    res.status(200).json({ events });
  } catch (error) {
    res.status(500).json({ error: "Failed to load activity" });
  }
}
