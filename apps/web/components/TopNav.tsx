'use client';

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { normalizeSavedViewQuery, type GlobalSearchResult, type SavedView } from "@/lib/db";
import { useSavedViews, optimisticUpdateSavedViews } from "@/hooks/useSavedViews";

const tabs = [
  { label: "Traders", key: "traders", href: "/?tab=traders" },
  { label: "Markets", key: "markets", href: "/?tab=markets" },
  { label: "Activity", key: "activity", href: "/?tab=activity" },
  { label: "Creators", key: "creators", href: "/?tab=creators" }
];

const filters = [
  { label: "Top", value: "top" },
  { label: "Boosted", value: "boosted" },
  { label: "Near Resolution", value: "resolution" },
  { label: "New", value: "new" }
];

export function TopNav({ initialSavedViews }: { initialSavedViews: SavedView[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentTab = searchParams.get("tab") ?? "traders";
  const currentFilter = searchParams.get("filter") ?? "top";
  const denseView = searchParams.get("density") === "compact";
  const initialQuery = useMemo(() => searchParams.get("q") ?? "", [searchParams]);
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const { views: savedViews, loading: savedLoading, isValidating } = useSavedViews(initialSavedViews);
  const [showSaved, setShowSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newViewLabel, setNewViewLabel] = useState("");
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [toasts, setToasts] = useState<Array<{ id: number; message: string; tone: "success" | "error" }>>([]);

  const showToast = (message: string, tone: "success" | "error") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3200);
  };

  const currentQueryNormalized = useMemo(() => normalizeSavedViewQuery(searchParams?.toString()), [searchParams]);

  const sortSavedViews = (views: SavedView[]) => {
    return [...views].sort((a, b) => {
      const aTime = a.updatedAt ?? a.createdAt ?? 0;
      const bTime = b.updatedAt ?? b.createdAt ?? 0;
      return bTime - aTime;
    });
  };

  const buildHref = ({
    tab,
    filter,
    density
  }: {
    tab?: string;
    filter?: string | null;
    density?: "compact" | null;
  } = {}) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab !== undefined) {
      if (tab) {
        params.set("tab", tab);
      } else {
        params.delete("tab");
      }
    }
    if (filter !== undefined) {
      if (filter) {
        params.set("filter", filter);
      } else {
        params.delete("filter");
      }
    }
    if (density !== undefined) {
      if (density === "compact") {
        params.set("density", "compact");
      } else {
        params.delete("density");
      }
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
        .then((res) => res.ok ? res.json() : Promise.reject(new Error("search_failed")))
        .then((payload) => {
          if (Array.isArray(payload?.rows)) {
            setSearchResults(payload.rows as GlobalSearchResult[]);
          } else {
            setSearchResults([]);
          }
        })
        .catch((error) => {
          if (error.name !== "AbortError") {
            setSearchResults([]);
          }
        })
        .finally(() => {
          setSearchLoading(false);
        });
    }, 200);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [searchTerm]);

  const serializeSearchParams = () => normalizeSavedViewQuery(searchParams?.toString());

  const buildFiltersObject = () => {
    const result: Record<string, string | string[]> = {};
    if (!searchParams) return result;
    for (const key of searchParams.keys()) {
      const values = searchParams.getAll(key);
      if (values.length === 1) {
        result[key] = values[0];
      } else if (values.length > 1) {
        result[key] = values;
      }
    }
    return result;
  };

  const handleCreateView = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const label = newViewLabel.trim();
    if (!label) return;
    setSaving(true);
    const previous = savedViews.map((entry) => ({ ...entry }));
    try {
      const body = {
        label,
        query: serializeSearchParams(),
        filters: buildFiltersObject()
      };
      const tempId = `temp-${Date.now()}`;
      const now = Math.floor(Date.now() / 1000);
      optimisticUpdateSavedViews((views) =>
        sortSavedViews([
          {
            id: tempId,
            label,
            query: body.query,
            filters: body.filters,
            createdAt: now,
            updatedAt: now
          },
          ...views
        ])
      );
      const res = await fetch("/api/saved-views", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        optimisticUpdateSavedViews(() => previous);
        showToast("Failed to save view", "error");
        return;
      }
      const payload = (await res.json()) as { view?: SavedView };
      if (payload?.view) {
        const nextView = payload.view;
        optimisticUpdateSavedViews((views) =>
          sortSavedViews([nextView, ...views.filter((entry) => entry.id !== tempId)])
        );
      }
      setNewViewLabel("");
      setShowSaved(true);
      showToast("View saved", "success");
    } finally {
      setSaving(false);
    }
  };

  const handleStartRename = (view: SavedView) => {
    setEditingViewId(view.id);
    setEditingLabel(view.label ?? view.id);
  };

  const handleCancelRename = () => {
    setEditingViewId(null);
    setEditingLabel("");
  };

  const handleRenameView = async (event: FormEvent<HTMLFormElement>, view: SavedView) => {
    event.preventDefault();
    if (renaming) return;
    const label = editingLabel.trim();
    if (!label) return;
    setRenaming(true);
    const previous = savedViews.map((entry) => ({ ...entry }));
    try {
      const updatedAt = Math.floor(Date.now() / 1000);
      optimisticUpdateSavedViews((views) =>
        sortSavedViews(
          views.map((entry) => (entry.id === view.id ? { ...entry, label, updatedAt } : entry))
        )
      );
      const res = await fetch(`/api/saved-views/${encodeURIComponent(view.id)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          label,
          query: view.query ?? null,
          filters: view.filters ?? null
        })
      });
      if (!res.ok) {
        optimisticUpdateSavedViews(() => previous);
        showToast("Failed to rename view", "error");
        return;
      }
      const payload = await res.json();
      if (payload?.view) {
        const updated = payload.view as SavedView;
        optimisticUpdateSavedViews((views) =>
          sortSavedViews(views.map((entry) => (entry.id === view.id ? updated : entry)))
        );
      }
      setEditingViewId(null);
      setEditingLabel("");
      showToast("View renamed", "success");
    } finally {
      setRenaming(false);
    }
  };

  const handleApplyView = (view: SavedView) => {
    const next = view.query?.trim();
    const target = next ? `${pathname}?${next}` : pathname;
    router.push(target as any);
    setShowSaved(false);
  };

  const handleDeleteView = async (view: SavedView) => {
    try {
      const previous = savedViews.map((entry) => ({ ...entry }));
      optimisticUpdateSavedViews((views) => views.filter((entry) => entry.id !== view.id));
      const res = await fetch(`/api/saved-views/${encodeURIComponent(view.id)}`, {
        method: "DELETE"
      });
      if (!res.ok) {
        optimisticUpdateSavedViews(() => previous);
        showToast("Failed to delete view", "error");
        return;
      }
      if (editingViewId === view.id) {
        handleCancelRename();
      }
      showToast("View deleted", "success");
    } catch (error) {
      // ignore
    }
  };

  return (
    <nav className="bk-flex bk-flex-col bk-gap-3 bk-py-4" aria-label="Primary">
      <div className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-4">
        <div className="bk-flex bk-items-center bk-gap-4">
          <Link href="/" className="bk-font-mono bk-text-sm bk-text-brand-text">
            Betkiller
          </Link>
          <span className="bk-hidden md:bk-inline-block bk-h-5 bk-w-px bk-bg-brand-ring/60" aria-hidden />
          <ul className="bk-flex bk-flex-wrap bk-gap-2">
            {tabs.map((tab) => {
              const isActive = currentTab === tab.key;
              return (
                <li key={tab.key}>
                  <Link
                    href={buildHref({ tab: tab.key }) as any}
                    className={`bk-inline-flex bk-items-center bk-justify-center bk-rounded-full bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
                      isActive
                        ? "bk-bg-brand-blue bk-text-black"
                        : "bk-text-brand-muted hover:bk-text-brand-text hover:bk-bg-brand-ring/40"
                    }`}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        <form action="/" method="get" role="search" className="bk-flex bk-items-center bk-gap-2">
          {Array.from(searchParams.entries())
            .filter(([key]) => key !== "q")
            .map(([key, value]) => (
              <input key={`${key}-${value}`} type="hidden" name={key} value={value} />
            ))}
          <label className="bk-relative bk-flex bk-items-center">
            <span className="bk-sr-only">Search markets</span>
            <input
              className="bk-w-60 lg:bk-w-72 bk-rounded-md bk-bg-brand-panel bk-border bk-border-brand-ring/60 bk-px-3 bk-py-2 bk-text-sm bk-text-brand-text placeholder:bk-text-brand-muted focus:bk-outline-none focus:bk-ring-1 focus:bk-ring-brand-blue"
              placeholder="Search traders, markets, activity"
              name="q"
              type="search"
              autoComplete="off"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
            />
            {showResults && searchTerm && (
              <div className="bk-absolute bk-top-full bk-mt-2 bk-w-full bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-panel bk-shadow-sm">
                {searchLoading && (
                  <div className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">Searching…</div>
                )}
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
          <div className="bk-relative">
            <button
              type="button"
              className="bk-rounded-full bk-border bk-border-brand-ring/40 bk-bg-brand-panel bk-px-3 bk-py-2 bk-text-xs bk-text-brand-muted hover:bk-text-brand-text"
              onClick={() => setShowSaved((prev) => !prev)}
              aria-expanded={showSaved}
            >
              Saved views
            </button>
            {showSaved && (
              <div className="bk-absolute bk-right-0 bk-z-20 bk-mt-2 bk-w-64 bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-panel bk-shadow-sm">
                <form onSubmit={handleCreateView} className="bk-flex bk-items-center bk-gap-2 bk-px-3 bk-py-2">
                  <input
                    type="text"
                    value={newViewLabel}
                    onChange={(event) => setNewViewLabel(event.target.value)}
                    placeholder="Name this view"
                    className="bk-flex-1 bk-rounded-md bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-px-2 bk-py-1 bk-text-2xs bk-text-brand-text"
                  />
                  <button
                    type="submit"
                    className="bk-rounded-full bk-bg-brand-blue bk-text-black bk-px-3 bk-py-1 bk-text-2xs bk-font-medium hover:bk-bg-brand-blue/90 disabled:bk-bg-brand-ring/40 disabled:bk-text-brand-muted"
                    disabled={saving || !newViewLabel.trim()}
                  >
                    Save
                  </button>
                </form>
                {isValidating && (
                  <div className="bk-px-3 bk-text-2xs bk-text-brand-muted">Syncing…</div>
                )}
                <div className="bk-max-h-72 bk-overflow-y-auto">
                  {savedLoading && <div className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">Loading…</div>}
                  {!savedLoading && savedViews.length === 0 && (
                    <div className="bk-px-3 bk-py-2 bk-text-2xs bk-text-brand-muted">No views saved yet.</div>
                  )}
                  {!savedLoading && savedViews.length > 0 && (
                    <ul className="bk-divide-y bk-divide-brand-ring/20">
                      {savedViews.map((view) => {
                        const isEditing = editingViewId === view.id;
                        const isActive = normalizeSavedViewQuery(view.query ?? "") === currentQueryNormalized;
                        const label = view.label ?? view.id;
                        return (
                          <li key={view.id} className="bk-px-3 bk-py-2">
                            {isEditing ? (
                              <form
                                onSubmit={(event) => handleRenameView(event, view)}
                                className="bk-flex bk-items-center bk-gap-2"
                              >
                                <input
                                  type="text"
                                  value={editingLabel}
                                  onChange={(event) => setEditingLabel(event.target.value)}
                                  className="bk-flex-1 bk-rounded-md bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-px-2 bk-py-1 bk-text-2xs bk-text-brand-text"
                                  autoFocus
                                />
                                <button
                                  type="submit"
                                  className="bk-rounded-full bk-bg-brand-blue bk-text-black bk-px-2 bk-py-1 bk-text-2xs bk-font-medium hover:bk-bg-brand-blue/90 disabled:bk-bg-brand-ring/40 disabled:bk-text-brand-muted"
                                  disabled={renaming || !editingLabel.trim()}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
                                  onClick={handleCancelRename}
                                >
                                  Cancel
                                </button>
                              </form>
                            ) : (
                              <div className="bk-flex bk-items-center bk-justify-between bk-gap-2">
                                <button
                                  type="button"
                                  className={`bk-flex-1 bk-text-left bk-text-xs bk-rounded-md bk-px-2 bk-py-1 ${
                                    isActive
                                      ? "bk-bg-brand-blue/20 bk-text-brand-blue"
                                      : "bk-text-brand-text hover:bk-text-brand-blue"
                                  }`}
                                  onClick={() => handleApplyView(view)}
                                >
                                  {label}
                                </button>
                                {isActive && <span className="bk-text-2xs bk-text-brand-blue">Active</span>}
                                <button
                                  type="button"
                                  className="bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
                                  onClick={() => handleStartRename(view)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
                                  onClick={() => handleDeleteView(view)}
                                  aria-label={`Delete ${view.label ?? view.id}`}
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </form>
      </div>
      <div className="bk-flex bk-flex-wrap bk-items-center bk-gap-2">
        <span className="bk-text-xs bk-text-brand-muted">Quick filters</span>
        {filters.map((filter) => {
          const isActive = currentFilter === filter.value;
          return (
            <Link
              key={filter.value}
              href={buildHref({ filter: filter.value }) as any}
              className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs ${
                isActive
                  ? "bk-bg-brand-surface bk-border bk-border-brand-blue/40 bk-text-brand-text"
                  : "bk-bg-transparent bk-border bk-border-brand-ring/40 bk-text-brand-muted hover:bk-text-brand-text"
              }`}
            >
              {filter.label}
            </Link>
          );
        })}
        <div className="bk-flex-1" />
        <Link
          href={buildHref({ density: denseView ? null : "compact" }) as any}
          className={`bk-rounded-full bk-px-3 bk-py-1 bk-text-xs bk-font-medium ${
            denseView
              ? "bk-bg-brand-blue/80 bk-text-black"
              : "bk-bg-transparent bk-border bk-border-brand-ring/40 bk-text-brand-muted hover:bk-text-brand-text"
          }`}
          aria-pressed={denseView}
        >
          Compact view
        </Link>
      </div>
      <div className="bk-fixed bk-right-6 bk-bottom-6 bk-space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`bk-rounded-xl bk-border bk-border-brand-ring/30 bk-px-4 bk-py-2 bk-text-xs bk-shadow-sm bk-flex bk-items-center bk-gap-2 ${
              toast.tone === "success" ? "bk-bg-success/20 bk-text-success" : "bk-bg-danger/20 bk-text-danger"
            }`}
          >
            <span>{toast.message}</span>
            <button
              type="button"
              aria-label="Dismiss"
              className="bk-text-[10px] bk-text-brand-muted hover:bk-text-brand-text"
              onClick={() => setToasts((prev) => prev.filter((entry) => entry.id !== toast.id))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </nav>
  );
}
