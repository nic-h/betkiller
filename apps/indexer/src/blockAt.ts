import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL!) });

export async function findBlockAt(timestampSec: number): Promise<bigint> {
  const latest = await client.getBlock();
  let lo = 1n;
  let hi = latest.number;
  while (lo < hi) {
    const mid = (lo + hi) >> 1n;
    const b = await client.getBlock({ blockNumber: mid });
    (Number(b.timestamp) >= timestampSec) ? (hi = mid) : (lo = mid + 1n);
  }
  return lo;
}

export { client };
