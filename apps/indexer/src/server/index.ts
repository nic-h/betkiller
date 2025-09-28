import { createServer } from "node:http";
import { URL } from "node:url";
import { handleRewardsRoute } from "./routes/rewards.js";
import { getIndexerHealthSnapshot } from "../db.js";

export function startHttpServer() {
  const port = Number(process.env.HTTP_PORT ?? "4010");
  const host = process.env.HTTP_HOST ?? "0.0.0.0";
  const chainId = Number(process.env.CHAIN_ID ?? "8453");

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        res.statusCode = 400;
        res.end("missing url");
        return;
      }
      const method = req.method ?? "GET";
      const requestUrl = new URL(req.url, `http://${req.headers.host ?? `${host}:${port}`}`);
      const pathname = requestUrl.pathname ?? "/";

      if (method === "GET" && pathname.startsWith("/rewards/")) {
        await handleRewardsRoute(req, res);
        return;
      }

      if (method === "GET" && pathname === "/health") {
        const snapshot = getIndexerHealthSnapshot(chainId);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(
          JSON.stringify({
            status: "ok",
            chainId: snapshot.chainId,
            lastBlock: snapshot.lastBlock,
            lastTs: snapshot.lastTs,
            lastUpdatedAt: snapshot.lastUpdatedAt,
            rewardsLastBlock: snapshot.rewardsLastBlock,
            rewardsLastSyncedAt: snapshot.rewardsLastSyncedAt
          })
        );
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    } catch (error) {
      res.statusCode = 500;
      res.end("internal error");
    }
  });

  server.listen(port, host, () => {
    console.log(`[server] listening on http://${host}:${port}`);
  });
}
