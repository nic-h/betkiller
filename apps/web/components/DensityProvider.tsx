'use client';

import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type DensityMode = "compact" | "comfortable";

const STORAGE_KEY = "context.density";
const DEFAULT_DENSITY: DensityMode = (process.env.DENSITY_DEFAULT as DensityMode | undefined) ?? "compact";

type DensityContextValue = {
  density: DensityMode;
  setDensity: (mode: DensityMode) => void;
};

const DensityContext = createContext<DensityContextValue | null>(null);

function readStoredDensity(): DensityMode | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  return stored === "comfortable" ? "comfortable" : stored === "compact" ? "compact" : null;
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialFromUrl = (() => {
    const value = searchParams?.get("density");
    return value === "comfortable" ? "comfortable" : value === "compact" ? "compact" : null;
  })();
  const initial = initialFromUrl ?? readStoredDensity() ?? DEFAULT_DENSITY;
  const [density, setDensityState] = useState<DensityMode>(initial);
  const mounted = useRef(false);

  const updateUrl = useCallback(
    (value: DensityMode) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (value === "compact") {
        params.set("density", "compact");
      } else {
        params.delete("density");
      }
      const query = params.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(target as any, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const setDensity = useCallback(
    (value: DensityMode) => {
      setDensityState(value);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, value);
      }
      updateUrl(value);
    },
    [updateUrl]
  );

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, density);
      }
      if (initialFromUrl == null) {
        updateUrl(density);
      }
      return;
    }

    const urlDensity = searchParams?.get("density");
    const normalized = urlDensity === "comfortable" ? "comfortable" : urlDensity === "compact" ? "compact" : null;
    if (normalized && normalized !== density) {
      setDensityState(normalized);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, normalized);
      }
    }
  }, [density, initialFromUrl, searchParams, updateUrl]);

  const value = useMemo(() => ({ density, setDensity }), [density, setDensity]);

  return <DensityContext.Provider value={value}>{children}</DensityContext.Provider>;
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext);
  if (!ctx) {
    throw new Error("useDensity must be used within DensityProvider");
  }
  return ctx;
}
