import { getProfile, touchProfile, upsertProfile } from "./db.js";

const BASE = process.env.CONTEXT_BASE || "https://context.markets";
const PROFILE_TTL_SECONDS = Number(process.env.PROFILE_TTL_SECONDS ?? 86_400);
const PROFILE_CONCURRENCY = Math.max(1, Number(process.env.PROFILE_CONCURRENCY ?? 4));
const USER_AGENT = process.env.PROFILE_USER_AGENT ?? "ContextEdgeIndexer/1.0";

async function tryJSON(url: string) {
  try {
    const res = await fetch(url, { headers: { accept: "application/json", "user-agent": USER_AGENT } });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    return null;
  }
}

async function getText(url: string) {
  const res = await fetch(url, { headers: { accept: "text/html", "user-agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`fetch failed ${url}`);
  }
  return await res.text();
}

function parseNextData(html: string): any | null {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    return null;
  }
}

function findProfilesInJSON(obj: any): Array<{ address: string; name?: string; x?: string }> {
  const results: Array<{ address: string; name?: string; x?: string }> = [];

  const visit = (value: any) => {
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const maybeAddress = typeof value.address === "string" ? value.address : undefined;
    if (maybeAddress && /^0x[a-fA-F0-9]{40}$/.test(maybeAddress)) {
      results.push({
        address: maybeAddress,
        name: value.displayName || value.name || value.username || undefined,
        x: value.twitter || value.x || value.xHandle || undefined
      });
    }

    for (const key of Object.keys(value)) {
      visit(value[key]);
    }
  };

  visit(obj);
  return results;
}

function findProfilesInHTML(address: string, html: string) {
  const name =
    /"displayName"\s*:\s*"([^"]+)"/i.exec(html)?.[1] ||
    /data-display-name="([^"]+)"/i.exec(html)?.[1] ||
    /class="[^"]*username[^"]*">([^<]+)/i.exec(html)?.[1];

  const x = /https?:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i.exec(html)?.[1];

  return { address, name, x };
}

export async function resolveAndStoreProfiles(addresses: string[]) {
  if (!process.env.PROFILE_SCRAPE) return;
  if (addresses.length === 0) return;

  const now = Math.floor(Date.now() / 1000);
  const normalized = Array.from(new Set(addresses.map((addr) => addr.toLowerCase())));

  const toLookup: string[] = [];
  for (const address of normalized) {
    const existing = getProfile(address);
    if (existing && typeof existing.lastSeen === "number" && now - existing.lastSeen < PROFILE_TTL_SECONDS) {
      touchProfile(address, now);
    } else {
      toLookup.push(address);
    }
  }

  if (toLookup.length === 0) {
    return;
  }

  const resolved = new Set<string>();
  const candidates = [
    `${BASE}/api/leaderboard`,
    `${BASE}/api/leaderboard?period=overall`,
    `${BASE}/api/users`
  ];

  for (const url of candidates) {
    const json = await tryJSON(url);
    if (!json) continue;
    const found = findProfilesInJSON(json);
    for (const profile of found) {
      upsertProfile.run({
        address: profile.address.toLowerCase(),
        display_name: profile.name ?? null,
        x_handle: profile.x ?? null,
        last_seen: now
      });
      resolved.add(profile.address.toLowerCase());
    }
  }

  const remaining = toLookup.filter((addr) => !resolved.has(addr));
  if (remaining.length === 0) {
    return;
  }

  const tasks = remaining.map((address) => async () => {
    const pages = [
      `${BASE}/u/${address}`,
      `${BASE}/users/${address}`,
      `${BASE}/address/${address}`,
      `${BASE}/profile/${address}`
    ];

    let resolved = false;
    for (const url of pages) {
      try {
        const html = await getText(url);
        const nextData = parseNextData(html);
        if (nextData) {
          const found = findProfilesInJSON(nextData).find((p) => p.address?.toLowerCase() === address);
          if (found) {
            upsertProfile.run({
              address,
              display_name: found.name ?? null,
              x_handle: found.x ?? null,
              last_seen: now
            });
            resolved = true;
            break;
          }
        }

        const fallback = findProfilesInHTML(address, html);
        if (fallback.name || fallback.x) {
          upsertProfile.run({
            address,
            display_name: fallback.name ?? null,
            x_handle: fallback.x ?? null,
            last_seen: now
          });
          resolved = true;
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!resolved) {
      upsertProfile.run({
        address,
        display_name: null,
        x_handle: null,
        last_seen: now
      });
    }
  });

  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(PROFILE_CONCURRENCY, queue.length) }, async function worker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (!task) break;
      await task();
    }
  });
  await Promise.all(workers);
}
