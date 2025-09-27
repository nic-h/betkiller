import { LOOKBACK_DAYS } from "../config/context.js";

const APPROX_BLOCK_TIME_SECONDS = 2.2;

type BlockWindowClient = { getBlockNumber: () => Promise<bigint> };

export async function initWindow(client: BlockWindowClient) {
  const latestNumber = await client.getBlockNumber();
  const seconds = LOOKBACK_DAYS * 24 * 60 * 60;
  const offset = Math.floor(seconds / APPROX_BLOCK_TIME_SECONDS);
  const fromBlock = Math.max(1, Number(latestNumber) - offset);
  return { fromBlock, toBlock: Number(latestNumber) };
}
