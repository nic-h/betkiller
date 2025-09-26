import { JsonRpcProvider } from "ethers";

export async function blockForDaysAgo(provider: JsonRpcProvider, days: number): Promise<number> {
  const tip = await provider.getBlockNumber();
  const tipBlock = await provider.getBlock(tip);
  if (!tipBlock) throw new Error("no tip block");

  const target = Math.floor(Date.now() / 1000) - days * 86_400;

  let lo = 0;
  let hi = tip;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const block = await provider.getBlock(mid);
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
