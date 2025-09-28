'use client';

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const tabs = [
  { label: "Traders", key: "traders" },
  { label: "Markets", key: "markets" },
  { label: "Activity", key: "activity" },
  { label: "Creators", key: "creators" }
];

const filters = [
  { label: "Top", value: "top" },
  { label: "Boosted", value: "boosted" },
  { label: "Near Resolution", value: "resolution" },
  { label: "New", value: "new" }
];

type SearchResult = {
  type: "market" | "wallet";
  id: string;
  title: string;
  subtitle?: string;
};

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentTab = searchParams.get("tab") ?? "traders";
  const currentFilter = searchParams.get("filter") ?? "top";
  const denseView = searchParams.get("density") === "compact";

  const initialQuery = useMemo(() => searchParams.get("q") ?? "", [searchParams]);
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const buildHref = ({ tab, filter, density }: { tab?: string; filter?: string | null; density?: "compact" | null }) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab !== undefined) {
      if (tab) params.set("tab", tab);
      else params.delete("tab");
    }
    if (filter !== undefined) {
      if (filter) params.set("filter", filter);
      else params.delete("filter");
    }
    if (density !== undefined) {
      if (density === "compact") params.set("density", "compact");
      else params.delete("density");
    }
    const query = params.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  useEffect(() => {
    if (!searchTerm) {
      setSearchResults([]);
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

  const handleTabClick = (tab: string) => {
    router.push(buildHref({ tab }) as any);
  };

  const handleFilterClick = (value: string) => {
    router.push(buildHref({ filter: value }) as any);
  };

  const handleDensityToggle = () => {
    router.push(buildHref({ density: denseView ? null : "compact" }) as any);
  };

  return (
    <nav className="bk-flex bk-flex-col bk-gap-3 bk-py-4" aria-label="Primary">
      <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-4">
        <div className="bk-flex bk-items-center bk-gap-4">
          <Link href="/" className="bk-font-mono bk-text-sm bk-text-brand-text">
            context.dash
          </Link>
          <span className="bk-hidden md:bk-inline-block bk-h-5 bk-w-px bk-bg-brand-ring/60" aria-hidden />
          <ul className="bk-flex bk-flex-wrap bk-gap-2">
            {tabs.map((tab) => {
              const isActive = currentTab === tab.key;
              return (
                <li key={tab.key}>
                  <button
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
                </li>
              );
            })}
          </ul>
        </div>
        <div className="bk-flex bk-items-center bk-gap-2">
          <label className="bk-relative bk-flex bk-items-center">
            <span className="bk-sr-only">Search markets</span>
            <input
              className="bk-w-60 lg:bk-w-72 bk-rounded-md bk-bg-brand-panel bk-border bk-border-brand-ring/60 bk-px-3 bk-py-2 bk-text-sm bk-text-brand-text placeholder:bk-text-brand-muted focus:bk-outline-none focus:bk-ring-1 focus:bk-ring-brand-blue"
              placeholder="Search traders, markets, activity"
              type="search"
              autoComplete="off"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
            />
            {showResults && searchTerm && (
              <div className="bk-absolute bk-top-full bk-mt-2 bk-w-full bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-panel bk-shadow-sm">
                {searchLoading && <div className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">Searching…</div>}
                {!searchLoading && searchResults.length === 0 && (
                  <div className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">No matches</div>
                )}
                {!searchLoading && searchResults.length > 0 && (
                  <ul className="bk-max-h-64 bk-overflow-y-auto bk-text-xs">
                    {searchResults.map((result) => (
                      <li key={`${result.type}-${result.id}`} className="bk-border-t bk-border-brand-ring/20 first:bk-border-t-0">
                        <a
                          href={result.type === "market"
                            ? `https://context.markets/markets/${result.id}`
                            : `https://context.markets/u/${result.id}`}
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
          <button
            type="button"
            onClick={handleDensityToggle}
            className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-font-medium ${
              denseView
                ? "bk-bg-brand-blue bk-text-black"
                : "bk-border bk-border-brand-ring/40 bk-text-brand-muted hover:bk-text-brand-text"
            }`}
          >
            Compact view
          </button>
        </div>
      </div>
      <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-2">
        <span className="bk-text-xs bk-text-brand-muted">Quick filters</span>
        {filters.map((filter) => {
          const isActive = currentFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              onClick={() => handleFilterClick(filter.value)}
              className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-font-medium ${
                isActive
                  ? "bk-bg-brand-surface bk-border bk-border-brand-blue/40 bk-text-brand-text"
                  : "bk-bg-transparent bk-border bk-border-brand-ring/40 bk-text-brand-muted hover:bk-text-brand-text"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
        <div className="bk-flex-1" />
      </div>
    </nav>
  );
}
