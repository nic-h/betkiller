import type { IncomingMessage, ServerResponse } from "node:http";
import { getRewardsForAddress } from "../../db.js";

export async function handleRewardsRoute(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? "/";
  const parts = url.split("/").filter(Boolean);
  if (parts.length < 2 || parts[0] !== "rewards") {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "missing_address" }));
    return;
  }
  const addressParam = parts[1];
  try {
    const base = getRewardsForAddress(addressParam);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(base));
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: "rewards_failed" }));
  }
}
