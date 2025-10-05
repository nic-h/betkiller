const ENV_URL = (process.env.INDEXER_URL ?? process.env.BK_INDEXER_URL ?? "").trim();

function baseUrl(): string {
  const candidate = (ENV_URL || "http://localhost:4010").replace(/\/$/, "");
  return candidate;
}

export async function fetchIndexerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {})
      },
      cache: "no-store",
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`Indexer request failed (${res.status})`);
    }
    const data = (await res.json()) as T;
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export function getIndexerBaseUrl(): string | null {
  try {
    return baseUrl();
  } catch (error) {
    return null;
  }
}
