import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { getEnv } from "@/lib/env";

const walletParam = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((value) => value.toLowerCase());

const querySchema = z.object({ wallet: walletParam });

type ProfilePayload = {
  username: string;
  profile_url: string;
  avatar_url?: string | null;
};

type CacheEntry = {
  payload: ProfilePayload | null;
  expiresAt: number;
};

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).end();
    return;
  }

  const parseResult = querySchema.safeParse(req.query);
  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid wallet parameter" });
    return;
  }

  const wallet = parseResult.data.wallet;
  const cached = cache.get(wallet);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    sendResponse(res, cached.payload);
    return;
  }

  try {
    const profile = await fetchProfile(wallet);
    cache.set(wallet, { payload: profile, expiresAt: now + CACHE_TTL_MS });
    sendResponse(res, profile);
  } catch (error) {
    cache.set(wallet, { payload: null, expiresAt: now + CACHE_TTL_MS / 6 });
    res.status(204).end();
  }
}

async function fetchProfile(wallet: string): Promise<ProfilePayload | null> {
  const endpoint = getEnv("CONTEXT_PROFILE_ENDPOINT");
  const url = `${endpoint}${wallet}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (response.status === 204 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Profile lookup failed with status ${response.status}`);
  }

  const json = (await response.json()) as ProfilePayload;
  if (!json || typeof json.username !== "string" || typeof json.profile_url !== "string") {
    throw new Error("Invalid payload from profile endpoint");
  }

  return {
    username: json.username,
    profile_url: json.profile_url,
    avatar_url: json.avatar_url ?? null
  };
}

function sendResponse(res: NextApiResponse, payload: ProfilePayload | null) {
  if (!payload) {
    res.status(204).end();
    return;
  }

  res.status(200).json(payload);
}
