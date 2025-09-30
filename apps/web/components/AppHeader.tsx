'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDensity } from "@/components/DensityProvider";
import { useRange } from "@/components/RangeProvider";
import { RANGE_OPTIONS, type RangeKey, formatRangeLabel } from "@/lib/range";

const STALE_THRESHOLD_MINUTES = Number(process.env.STALE_THRESHOLD_MINUTES ?? 5);

const TABS = [
  { key: "traders", label: "Traders" },
  { key: "markets", label: "Markets" },
  { key: "activity", label: "Activity" },
  { key: "creators", label: "Creators" }
] as const;

const FILTERS = [
  { label: "Top", value: "top" },
  { label: "Boosted", value: "boosted" },
  { label: "Near resolution", value: "resolution" },
  { label: "New", value: "new" }
] as const;

type TabKey = (typeof TABS)[number]["key"];
type FilterKey = (typeof FILTERS)[number]["value"];

type SearchResult = {
  type: "market" | "wallet";
  id: string;
  title: string;
  subtitle?: string;
};

type HealthResponse = {
  minutesAgo?: number | null;
};

const fetcher = (url: string) =>
  fetch(url, { cache: "no-store" }).then((res) => (res.ok ? res.json() : Promise.reject(new Error("fetch_failed"))));

export function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { range, setRange } = useRange();
  const { density, setDensity } = useDensity();

  const activeTab = normalizeTab(searchParams?.get("tab"));
  const activeFilter = normalizeFilter(searchParams?.get("filter"));

  const initialQuery = useMemo(() => searchParams?.get("q") ?? "", [searchParams]);
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  useEffect(() => {
    if (!searchTerm) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(searchTerm)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("search_failed"))))
        .then((payload) => {
          if (Array.isArray(payload?.rows)) {
            setSearchResults(payload.rows as SearchResult[]);
          } else {
            setSearchResults([]);
          }
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            setSearchResults([]);
          }
        })
        .finally(() => setSearchLoading(false));
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchTerm]);

  const { data } = useSWR<HealthResponse>("/api/health", fetcher, { refreshInterval: 60_000 });
  const minutesAgo = data?.minutesAgo ?? null;
  const loadingFreshness = minutesAgo == null;
  const stale = !loadingFreshness && minutesAgo > STALE_THRESHOLD_MINUTES;

  const handleTabClick = (key: TabKey) => {
    const url = updateParams(pathname, searchParams?.toString(), { tab: key === "traders" ? null : key });
    router.replace(url as any, { scroll: false });
  };

  const handleFilterClick = (value: FilterKey) => {
    const url = updateParams(pathname, searchParams?.toString(), { filter: value === "top" ? null : value });
    router.replace(url as any, { scroll: false });
  };

  const handleDensityToggle = () => {
    setDensity(density === "compact" ? "comfortable" : "compact");
  };

  const handleRangeChange = (value: RangeKey) => {
    if (value !== range) {
      setRange(value);
    }
  };

  return (
    <header className="bk-sticky bk-top-0 bk-z-40 bk-border-b bk-border-brand-ring/30 bk-bg-[hsla(var(--bk-bg),0.92)] bk-backdrop-blur">
      <div className="bk-mx-auto bk-flex bk-flex-col bk-gap-4 bk-px-6 bk-py-4 lg:bk-max-w-7xl">
        <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-4">
          <div className="bk-flex bk-items-center bk-gap-3">
            <Link href="/" className="bk-font-mono bk-text-sm bk-text-brand-text">
              context.dash
            </Link>
            <FreshnessDot stale={stale} loading={loadingFreshness} minutesAgo={minutesAgo} />
          </div>
          <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-3">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              loading={searchLoading}
              results={searchResults}
              showResults={showResults}
              setShowResults={setShowResults}
            />
            <button
              type="button"
              onClick={handleDensityToggle}
              className={`bk-inline-flex bk-items-center bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
                density === "compact"
                  ? "bk-bg-brand-blue bk-text-black"
                  : "bk-text-brand-muted hover:bk-text-brand-text"
              }`}
            >
              {density === "compact" ? "Compact" : "Comfort"}
            </button>
          </div>
        </div>
        <div className="bk-flex bk-flex-col bk-gap-3">
          <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-2">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleTabClick(tab.key)}
                  className={`bk-inline-flex bk-items-center bk-justify-center bk-rounded-full bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
                    isActive
                      ? "bk-bg-brand-blue bk-text-black"
                      : "bk-text-brand-muted hover:bk-text-brand-text hover:bk-bg-brand-ring/40"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
            <div className="bk-flex-1" />
            <RangeChips active={range} onChange={handleRangeChange} />
          </div>
          <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-2">
            <span className="bk-text-2xs bk-text-brand-muted">Quick filters</span>
            {FILTERS.map((filter) => {
              const isActive = activeFilter === filter.value;
              return (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => handleFilterClick(filter.value)}
                  className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-2xs bk-font-medium ${
                    isActive
                      ? "bk-bg-brand-surface bk-border bk-border-brand-blue/40 bk-text-brand-text"
                      : "bk-bg-transparent bk-border bk-border-brand-ring/40 bk-text-brand-muted hover:bk-text-brand-text"
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </header>
  );
}

function SearchInput({
  value,
  onChange,
  loading,
  results,
  showResults,
  setShowResults
}: {
  value: string;
  onChange: (next: string) => void;
  loading: boolean;
  results: SearchResult[];
  showResults: boolean;
  setShowResults: (next: boolean) => void;
}) {
  const shouldShow = showResults && (loading || value.length > 0 || results.length > 0);

  return (
    <label className="bk-relative bk-flex bk-items-center">
      <span className="bk-sr-only">Search</span>
      <input
        className="bk-w-60 lg:bk-w-72 bk-rounded-lg bk-border bk-border-brand-ring/40 bk-bg-brand-panel bk-px-3 bk-py-2 bk-text-sm bk-text-brand-text placeholder:bk-text-brand-muted focus:bk-outline-none focus:bk-ring-1 focus:bk-ring-brand-blue"
        type="search"
        autoComplete="off"
        placeholder="Search traders, markets, activity"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setShowResults(true)}
        onBlur={() => setTimeout(() => setShowResults(false), 120)}
      />
      {shouldShow && (
        <div className="bk-absolute bk-top-full bk-z-30 bk-mt-2 bk-w-full bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-panel bk-shadow-sm">
          {loading && <div className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">Searching…</div>}
          {!loading && results.length === 0 && value && (
            <div className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">No matches</div>
          )}
          {!loading && results.length > 0 && (
            <ul className="bk-max-h-64 bk-overflow-y-auto bk-text-xs">
              {results.map((result) => (
                <li key={`${result.type}-${result.id}`} className="bk-border-t bk-border-brand-ring/20 first:bk-border-t-0">
                  <a
                    href={
                      result.type === "market"
                        ? `https://context.markets/markets/${result.id}`
                        : `https://context.markets/u/${result.id}`
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="bk-flex bk-flex-col bk-gap-0.5 bk-px-3 bk-py-2 hover:bk-bg-brand-ring/40"
                  >
                    <span className="bk-text-brand-text">{result.title}</span>
                    {result.subtitle && <span className="bk-text-2xs bk-text-brand-muted">{result.subtitle}</span>}
                    <span className="bk-text-2xs bk-text-brand-muted">{result.type === "market" ? "Market" : "Wallet"}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </label>
  );
}

function RangeChips({ active, onChange }: { active: RangeKey; onChange: (value: RangeKey) => void }) {
  return (
    <div className="bk-inline-flex bk-items-center bk-gap-1" role="group" aria-label="Time range">
      {RANGE_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={`bk-inline-flex bk-items-center bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-3 bk-py-1.5 bk-text-2xs bk-font-medium ${
            active === option
              ? "bk-bg-brand-blue bk-text-black"
              : "bk-text-brand-muted hover:bk-text-brand-text"
          }`}
        >
          {formatRangeLabel(option)}
        </button>
      ))}
    </div>
  );
}

function FreshnessDot({ stale, loading, minutesAgo }: { stale: boolean; loading: boolean; minutesAgo: number | null }) {
  const tone = loading ? "bk-bg-brand-muted" : stale ? "bk-bg-warning" : "bk-bg-success";
  const title = loading
    ? "Indexer freshness unknown"
    : minutesAgo != null
    ? `Indexer updated ${minutesAgo.toFixed(1)} min ago`
    : "Indexer freshness unknown";
  return (
    <div className="bk-flex bk-items-center bk-gap-2" title={title}>
      <span className={`bk-h-2.5 bk-w-2.5 bk-rounded-full ${tone}`} aria-hidden />
      {!loading && minutesAgo != null && (
        <span className="bk-text-2xs bk-text-brand-muted">{minutesAgo.toFixed(1)}m</span>
      )}
    </div>
  );
}

function updateParams(
  pathname: string,
  serializedParams: string | null | undefined,
  updates: Record<string, string | null>
): string {
  const next = new URLSearchParams(serializedParams ?? "");
  for (const [key, value] of Object.entries(updates)) {
    if (value == null) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function normalizeTab(value: string | null | undefined): TabKey {
  const key = (value ?? "traders").toLowerCase();
  return TABS.some((tab) => tab.key === key) ? (key as TabKey) : "traders";
}

function normalizeFilter(value: string | null | undefined): FilterKey {
  const key = (value ?? "top").toLowerCase();
  return FILTERS.some((filter) => filter.value === key) ? (key as FilterKey) : "top";
}
