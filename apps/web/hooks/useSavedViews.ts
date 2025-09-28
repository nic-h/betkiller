'use client';

import useSWR, { mutate } from "swr";
import type { SavedView } from "@/lib/savedViews";

type SavedViewResponse = {
  chainId: number;
  rows: SavedView[];
};

async function fetcher(url: string): Promise<SavedViewResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  return res.json();
}

export function useSavedViews(initial?: SavedView[]) {
  const { data, error, isValidating } = useSWR<SavedViewResponse>("/api/saved-views", fetcher, {
    fallbackData: initial ? { chainId: 8453, rows: initial } : undefined,
    revalidateOnFocus: false,
    revalidateOnReconnect: false
  });

  return {
    views: data?.rows ?? initial ?? [],
    loading: !data && !error,
    error,
    isValidating
  };
}

export function optimisticUpdateSavedViews(updater: (views: SavedView[]) => SavedView[]) {
  mutate(
    "/api/saved-views",
    async (current: SavedViewResponse | undefined) => {
      const rows = updater(current?.rows ?? []);
      return { chainId: 8453, rows } satisfies SavedViewResponse;
    },
    false
  );
}
