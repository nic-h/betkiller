import { setTimeout as delayTimeout } from "node:timers/promises";
import { env } from "./env.js";
import { upsertMarketMentions } from "./db.js";

let mentionTimer: NodeJS.Timeout | null = null;
let mentionSyncInFlight = false;

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("0x")) return null;
  return trimmed.toLowerCase();
}

type MentionPayloadEntry = {
  marketId?: string;
  source?: string;
  window?: string;
  mentions?: number | string;
  authors?: number | string;
  velocity?: number | string;
  capturedAt?: number | string;
  metadata?: unknown;
};

async function fetchMentionPayload(url: string): Promise<MentionPayloadEntry[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`mention_feed_http_${res.status}`);
  }
  const payload = (await res.json()) as unknown;
  if (Array.isArray(payload)) {
    return payload as MentionPayloadEntry[];
  }
  if (payload && typeof payload === "object" && Array.isArray((payload as any).mentions)) {
    return (payload as { mentions: MentionPayloadEntry[] }).mentions;
  }
  return [];
}

export async function syncMarketMentions(log: (message: string, extra?: unknown) => void = console.log) {
  if (!env.mentionFeedUrl) {
    return;
  }
  if (mentionSyncInFlight) {
    return;
  }
  mentionSyncInFlight = true;
  try {
    const entries = await fetchMentionPayload(env.mentionFeedUrl);
    const capturedAtDefault = Math.floor(Date.now() / 1000);
    const rows = entries
      .map((entry) => {
        const marketId = normalizeId(entry.marketId);
        if (!marketId) return null;
        const source = entry.source?.trim?.() || "unknown";
        const mentions = Math.max(0, Math.trunc(parseNumber(entry.mentions)));
        if (mentions === 0) return null;
        const authors = parseNumber(entry.authors, NaN);
        const velocity = entry.velocity != null ? Number(parseNumber(entry.velocity)) : null;
        const capturedAt = Math.trunc(parseNumber(entry.capturedAt, capturedAtDefault));
        return {
          marketId,
          source,
          window: entry.window ?? null,
          mentions,
          authors: Number.isFinite(authors) ? Math.trunc(authors) : null,
          velocity: velocity != null && Number.isFinite(velocity) ? velocity : null,
          capturedAt,
          metadata: entry.metadata
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
    if (rows.length > 0) {
      upsertMarketMentions(rows);
      log(`[mentions] upserted ${rows.length} rows`);
    }
  } catch (error) {
    console.warn("mentions_sync_failed", error);
  } finally {
    mentionSyncInFlight = false;
  }
}

export function scheduleMentionSync(log: (message: string, extra?: unknown) => void = console.log) {
  if (!env.mentionFeedUrl) {
    log("[mentions] feed url not configured, skipping sync");
    return;
  }
  const interval = Math.max(60_000, env.mentionFetchIntervalMs || 300_000);
  const run = async () => {
    await syncMarketMentions(log);
    mentionTimer = setTimeout(run, interval);
  };
  if (mentionTimer) {
    clearTimeout(mentionTimer);
  }
  run().catch((error) => {
    console.warn("mentions_initial_sync_failed", error);
  });
}

export async function stopMentionSync() {
  if (mentionTimer) {
    clearTimeout(mentionTimer);
    mentionTimer = null;
  }
  while (mentionSyncInFlight) {
    await delayTimeout(50);
  }
}
