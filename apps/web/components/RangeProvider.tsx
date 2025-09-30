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
import {
  RANGE_DEFAULT,
  RANGE_OPTIONS,
  RANGE_STORAGE_KEY,
  type RangeKey,
  normalizeRange
} from "@/lib/range";

type RangeContextValue = {
  range: RangeKey;
  setRange: (value: RangeKey) => void;
};

const RangeContext = createContext<RangeContextValue | null>(null);

function readStoredRange(): RangeKey | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(RANGE_STORAGE_KEY);
  const normalized = normalizeRange(stored);
  return normalized ?? null;
}

export function RangeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialParam = normalizeRange(searchParams?.get("range"));
  const [range, setRangeState] = useState<RangeKey>(initialParam ?? readStoredRange() ?? RANGE_DEFAULT);
  const mounted = useRef(false);

  const setRange = useCallback(
    (value: RangeKey) => {
      if (!RANGE_OPTIONS.includes(value)) {
        throw new Error(`Invalid range: ${value}`);
      }
      setRangeState(value);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RANGE_STORAGE_KEY, value);
      }
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("range", value);
      const query = params.toString();
      const target = query ? `${pathname}?${query}` : pathname;
      router.replace(target as any, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  useEffect(() => {
    const paramRange = normalizeRange(searchParams?.get("range"));
    const storedRange = readStoredRange();
    const nextRange = paramRange ?? storedRange ?? RANGE_DEFAULT;

    if (!mounted.current) {
      mounted.current = true;
      setRangeState(nextRange);
      if (!paramRange) {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("range", nextRange);
        const query = params.toString();
        const target = query ? `${pathname}?${query}` : pathname;
        router.replace(target as any, { scroll: false });
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RANGE_STORAGE_KEY, nextRange);
      }
      return;
    }

    if (paramRange && paramRange !== range) {
      setRangeState(paramRange);
      if (typeof window !== "undefined") {
        window.localStorage.setItem(RANGE_STORAGE_KEY, paramRange);
      }
    }
  }, [pathname, range, router, searchParams]);

  const value = useMemo(() => ({ range, setRange }), [range, setRange]);

  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRange(): RangeContextValue {
  const ctx = useContext(RangeContext);
  if (!ctx) {
    throw new Error("useRange must be used within RangeProvider");
  }
  return ctx;
}
