import { JsonRpcProvider } from "ethers";
import { env } from "./env.js";

let urls = (process.env.RPC_URLS || process.env.RPC_URL || env.rpcUrls.join(","))
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0)
  .filter((entry) => !/<key>|your[_-]?key|xxxxx/i.test(entry));

if (urls.length === 0) {
  throw new Error("No usable RPC_URLS");
}

const providers = urls.map((url) => new JsonRpcProvider(url));

let idx = 0;
const QPS = Math.max(1, env.rpcQps ?? 2);
let last = 0;

async function throttle() {
  const gap = 1000 / QPS;
  const now = Date.now();
  const wait = Math.max(0, last + gap - now);
  if (wait) {
    await new Promise((resolve) => setTimeout(resolve, wait + Math.random() * gap * 0.2));
  }
  last = Date.now();
}

function looksRateLimited(error: any) {
  const message = (error?.message || "").toLowerCase();
  const code = error?.error?.code ?? error?.code;
  return message.includes("429") || message.includes("rate") || message.includes("limit") || message.includes("timeout") || code === -32002;
}

export async function rpcSend(method: string, params: any[]) {
  let lastError: any;
  for (let attempt = 0; attempt < providers.length; attempt++) {
    const providerIndex = (idx + attempt) % providers.length;
    const provider = providers[providerIndex];
    try {
      await throttle();
      const result = await provider.send(method, params);
      idx = (providerIndex + 1) % providers.length;
      return result;
    } catch (error: any) {
      lastError = error;
      if (looksRateLimited(error)) {
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
