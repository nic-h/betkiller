import type { NextApiRequest, NextApiResponse } from "next";
import { getHealthStatus } from "@/lib/health";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  const health = getHealthStatus();
  res.status(health.partial ? 206 : 200).json(health);
}
