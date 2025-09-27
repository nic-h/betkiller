import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { decodeEventLog } from 'viem';
import { predictionMarketAbi, vaultAbi, rewardDistributorAbi } from './abi.js';

const BASE = process.env.CONTEXT_BASE || 'https://context.markets';
const PROFILE_CONCURRENCY = Math.max(1, Number(process.env.PROFILE_CONCURRENCY ?? 4));
const USER_AGENT = process.env.PROFILE_USER_AGENT ?? 'ContextProfileEnricher/1.0';

const ADDRESSES_FILE = path.resolve(process.env.ADDRESSES_FILE ?? './src/context.addresses.base.json');
const LOGS_FILE = path.resolve('data/context_logs.jsonl');
const OUTPUT_FILE = path.resolve('data/context_profiles.jsonl');

const EVENT_ADDRESS_KEYS: Record<string, string[]> = {
  MarketCreated: ['creator', 'oracle', 'surplusRecipient'],
  MarketTraded: ['trader'],
  TokensRedeemed: ['redeemer'],
  SurplusWithdrawn: ['to'],
  LockUpdated: ['locker'],
  Unlocked: ['locker'],
  StakeUpdated: ['staker'],
  SponsoredLocked: ['user'],
  RewardClaimed: ['user'],
};

const CONTRACT_ABIS = (() => {
  const addrsRaw = JSON.parse(fs.readFileSync(ADDRESSES_FILE, 'utf8')) as {
    predictionMarket: string;
    vault: string;
    rewardDistributor: string;
  };
  const entries = [
    [addrsRaw.predictionMarket.toLowerCase(), predictionMarketAbi],
    [addrsRaw.vault.toLowerCase(), vaultAbi],
    [addrsRaw.rewardDistributor.toLowerCase(), rewardDistributorAbi],
  ] as const;
  return new Map(entries);
})();

type Profile = { address: string; displayName: string | null; xHandle: string | null; source: string | null };

async function main() {
  if (!fs.existsSync(LOGS_FILE)) {
    throw new Error(`Missing logs file at ${LOGS_FILE}`);
  }

  const participants = await collectParticipants();
  if (participants.size === 0) {
    console.log(JSON.stringify({ msg: 'no participant addresses discovered' }));
    return;
  }

  console.log(JSON.stringify({ msg: 'fetching profiles', addresses: participants.size }));
  const profiles = await fetchProfiles(Array.from(participants));

  const lines = Array.from(profiles.values()).map((profile) =>
    JSON.stringify({
      address: profile.address,
      displayName: profile.displayName,
      xHandle: profile.xHandle,
      source: profile.source,
    }) + '\n'
  );

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, lines.join(''));
  console.log(JSON.stringify({ msg: 'profiles written', file: OUTPUT_FILE, count: profiles.size }));
}

async function collectParticipants(): Promise<Set<string>> {
  const participants = new Set<string>();
  const stream = fs.createReadStream(LOGS_FILE, 'utf8');
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: any;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      continue;
    }

    const address = typeof parsed.address === 'string' ? parsed.address.toLowerCase() : undefined;
    if (!address) continue;

    const abi = CONTRACT_ABIS.get(address);
    if (!abi) continue;

    const topicsRaw = Array.isArray(parsed.topics) ? parsed.topics.filter((t: unknown): t is string => typeof t === 'string') : [];
    if (topicsRaw.length === 0) continue;

    try {
      const decoded = decodeEventLog({
        abi,
        data: parsed.data as `0x${string}`,
        topics: topicsRaw as [`0x${string}`, ...`0x${string}`[]],
        strict: false,
      });
      const eventName = decoded.eventName as keyof typeof EVENT_ADDRESS_KEYS | undefined;
      if (!eventName) continue;
      const keys = EVENT_ADDRESS_KEYS[eventName];
      if (!keys) continue;

      const args = (decoded as any).args as Record<string, unknown> | undefined;
      for (const key of keys) {
        const value = args?.[key];
        collectAddresses(value, participants);
      }
    } catch (error) {
      continue;
    }
  }

  return participants;
}

function collectAddresses(value: unknown, into: Set<string>) {
  if (!value) return;
  if (typeof value === 'string') {
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) {
      into.add(value.toLowerCase());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectAddresses(entry, into);
    return;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectAddresses(entry, into);
    }
  }
}

async function fetchProfiles(addresses: string[]): Promise<Map<string, Profile>> {
  const normalized = Array.from(new Set(addresses.map((addr) => addr.toLowerCase())));
  const targets = new Set(normalized);
  const results = new Map<string, Profile>();

  const candidates = [
    `${BASE}/api/leaderboard`,
    `${BASE}/api/leaderboard?period=overall`,
    `${BASE}/api/users`,
  ];

  for (const url of candidates) {
    const json = await tryJSON(url);
    if (!json) continue;
    const extracted = findProfilesInJSON(json);
    for (const profile of extracted) {
      const address = profile.address.toLowerCase();
      if (!targets.has(address)) continue;
      results.set(address, {
        address,
        displayName: profile.name ?? null,
        xHandle: profile.x ?? null,
        source: `json:${url}`,
      });
    }
  }

  const remaining = normalized.filter((addr) => !results.has(addr));
  if (remaining.length === 0) {
    return results;
  }

  const queue = [...remaining];
  const workers = Array.from({ length: Math.min(PROFILE_CONCURRENCY, queue.length) || 1 }, () =>
    (async function worker() {
      while (queue.length > 0) {
        const address = queue.shift();
        if (!address) break;
        const profile = await lookupIndividual(address);
        results.set(address, profile);
      }
    })()
  );
  await Promise.all(workers);

  return results;
}

async function lookupIndividual(address: string): Promise<Profile> {
  const pages = [
    `${BASE}/u/${address}`,
    `${BASE}/users/${address}`,
    `${BASE}/address/${address}`,
    `${BASE}/profile/${address}`,
  ];

  for (const url of pages) {
    try {
      const html = await getText(url);
      const nextData = parseNextData(html);
      if (nextData) {
        const match = findProfilesInJSON(nextData).find((p) => p.address.toLowerCase() === address);
        if (match) {
          return {
            address,
            displayName: match.name ?? null,
            xHandle: match.x ?? null,
            source: `next:${url}`,
          };
        }
      }

      const fallback = findProfilesInHTML(address, html);
      if (fallback.name || fallback.x) {
        return {
          address,
          displayName: fallback.name ?? null,
          xHandle: fallback.x ?? null,
          source: `html:${url}`,
        };
      }
    } catch (error) {
      continue;
    }
  }

  return { address, displayName: null, xHandle: null, source: null };
}

async function tryJSON(url: string) {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT } });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    return null;
  }
}

async function getText(url: string) {
  const res = await fetch(url, { headers: { accept: 'text/html', 'user-agent': USER_AGENT } });
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

function findProfilesInJSON(value: any): Array<{ address: string; name?: string; x?: string }> {
  const results: Array<{ address: string; name?: string; x?: string }> = [];

  const visit = (input: any) => {
    if (!input || typeof input !== 'object') return;
    if (Array.isArray(input)) {
      for (const entry of input) visit(entry);
      return;
    }

    const maybeAddress = typeof (input as any).address === 'string' ? (input as any).address : undefined;
    if (maybeAddress && /^0x[a-fA-F0-9]{40}$/.test(maybeAddress)) {
      results.push({
        address: maybeAddress,
        name: (input as any).displayName || (input as any).name || (input as any).username || undefined,
        x: (input as any).twitter || (input as any).x || (input as any).xHandle || undefined,
      });
    }

    for (const entry of Object.values(input as Record<string, unknown>)) {
      visit(entry);
    }
  };

  visit(value);
  return results;
}

function findProfilesInHTML(address: string, html: string) {
  const name =
    /"displayName"\s*:\s*"([^"]+)"/i.exec(html)?.[1] ||
    /data-display-name="([^"]+)"/i.exec(html)?.[1] ||
    /class="[^"]*username[^"]*">([^<]+)/i.exec(html)?.[1] ||
    null;

  const x = /https?:\/\/(?:x|twitter)\.com\/([A-Za-z0-9_]+)/i.exec(html)?.[1] || null;

  return { address, name, x };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
