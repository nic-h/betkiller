import { getEnv } from "@/lib/env";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

let cachedClient: ReturnType<typeof createPublicClient> | null = null;

export function getPublicClient() {
  if (!cachedClient) {
    const rpcUrl = getEnv("RPC_URL");
    cachedClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl)
    });
  }
  return cachedClient;
}
