import { rpcSend } from "./rpcPool.js";
import { env } from "./env.js";

const toHex = (value: number | bigint) => {
  const numeric = typeof value === "bigint" ? value : BigInt(Math.floor(value));
  return `0x${numeric.toString(16)}`;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_TIMEOUT = env.rpcTimeoutMs ?? 15000;

function isRateLimitOrTimeout(error: any) {
  const message = (error?.message || error?.shortMessage || "").toLowerCase();
  const code = error?.error?.code ?? error?.code;
  return message.includes("timeout") || message.includes("rate") || message.includes("429") || code === -32002;
}

async function rpcSendWithTimeout(method: string, params: any[]) {
  return await Promise.race([
    rpcSend(method, params),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), DEFAULT_TIMEOUT))
  ]);
}

export async function* getLogsAdaptive(opts: {
  fromBlock: number;
  toBlock: number;
  address?: string | string[];
  topics?: (string | null | string[])[];
}) {
  const max = opts.toBlock;
  let from = opts.fromBlock;
  let span = env.logInitSpan;
  const maxSpan = env.logMaxSpan;
  const minSpan = env.logMinSpan;
  let spanCap = maxSpan;

  while (from <= max) {
    const effectiveSpan = Math.max(1, span);
    const to = Math.min(from + effectiveSpan - 1, max);
    const filter: Record<string, unknown> = {
      fromBlock: toHex(from),
      toBlock: toHex(to)
    };
    if (opts.address) filter.address = opts.address;
    if (opts.topics) filter.topics = opts.topics;

    try {
      const logs = await rpcSendWithTimeout("eth_getLogs", [filter]);
      yield logs as any[];
      from = to + 1;
      span = Math.min(Math.floor(span * 1.25), spanCap);
    } catch (error: any) {
      const message = (error?.message || error?.shortMessage || "").toLowerCase();
      const limitedRange =
        message.includes("free tier") ||
        message.includes("block range") ||
        message.includes("result set too large") ||
        message.includes("more than") ||
        message.includes("exceed") ||
        error?.error?.code === -32600;

      if (limitedRange) {
        spanCap = Math.min(spanCap, 10);
      }

      if (limitedRange || isRateLimitOrTimeout(error)) {
        const lowerBound = Math.max(1, Math.min(minSpan, spanCap));
        const nextSpan = Math.floor(span / 2);
        span = Math.max(lowerBound, Math.min(nextSpan, spanCap));
        if (span <= 0) {
          span = lowerBound;
        }
        await sleep(400 + Math.floor(Math.random() * 400));
        continue;
      }
      console.error("getLogs error", { from, to, err: error?.message || error });
      from = Math.min(from + 1, max);
      const lowerBound = Math.max(1, Math.min(minSpan, spanCap));
      const nextSpan = Math.floor(span / 2);
      span = Math.max(lowerBound, Math.min(nextSpan, spanCap));
      if (span <= 0) {
        span = lowerBound;
      }
    }
  }
}
