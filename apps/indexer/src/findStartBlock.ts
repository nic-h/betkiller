import { JsonRpcProvider } from "ethers";

const MAX_ATTEMPTS = Number(process.env.RPC_MAX_ATTEMPTS ?? 6);
const RETRY_DELAY_MS = Number(process.env.RPC_RETRY_DELAY_MS ?? 1_500);

async function withRetry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (attempt >= MAX_ATTEMPTS) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * Math.pow(2, attempt)));
    return withRetry(fn, attempt + 1);
  }
}

export async function blockForDaysAgo(provider: JsonRpcProvider, days: number): Promise<number> {
  const tip = await withRetry(() => provider.getBlockNumber());
  const tipBlock = await withRetry(() => provider.getBlock(tip));
  if (!tipBlock) throw new Error("no tip block");

  const target = Math.floor(Date.now() / 1000) - days * 86_400;

  let lo = 0;
  let hi = tip;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const block = await withRetry(() => provider.getBlock(mid));
    if (!block) {
      hi = mid;
      continue;
    }
    if (Number(block.timestamp) < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}
