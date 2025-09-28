export type GlobalSearchResult = {
  type: "market" | "wallet";
  id: string;
  title: string;
  subtitle?: string;
  score: number;
};

export type SavedView = {
  id: string;
  label: string;
  query?: string;
  filters?: Record<string, unknown>;
  createdAt?: number | null;
  updatedAt?: number | null;
};

export function normalizeSavedViewQuery(query?: string | null): string {
  if (!query) return "";
  const trimmed = query.startsWith("?") ? query.slice(1) : query;
  if (!trimmed) return "";
  const params = new URLSearchParams(trimmed);
  const map = new Map<string, string[]>();
  for (const [key, value] of params.entries()) {
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(value);
  }
  const keys = Array.from(map.keys()).sort();
  const normalized = new URLSearchParams();
  for (const key of keys) {
    const values = map.get(key)!;
    values.sort();
    for (const value of values) {
      normalized.append(key, value);
    }
  }
  return normalized.toString();
}
