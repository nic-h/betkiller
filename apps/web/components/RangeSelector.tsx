'use client';

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { RANGE_OPTIONS, type RangeKey } from "@/lib/range";

export function RangeSelector({ active }: { active: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const handleClick = (value: RangeKey) => {
    if (value === active) return;
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("range", value);
    const query = params.toString();
    const target = query ? `${pathname}?${query}` : pathname;
    router.replace(target, { scroll: false });
  };

  return (
    <div className="bk-inline-flex bk-gap-2">
      {RANGE_OPTIONS.map((option) => {
        const isActive = option === active;
        return (
          <button
            key={option}
            type="button"
            onClick={() => handleClick(option)}
            className={`bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
              isActive ? "bk-bg-brand-blue bk-text-black" : "bk-text-brand-muted hover:bk-text-brand-text"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
