'use client';

import { useEffect, useRef, useState } from "react";

import { METRIC_DICTIONARY } from "@/lib/metrics";

export function MetricsPopover() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="bk-relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="bk-inline-flex bk-h-8 bk-items-center bk-rounded-full bk-border bk-border-brand-ring/40 bk-bg-brand-surface bk-px-3 bk-text-xs bk-text-brand-muted hover:bk-text-brand-text"
      >
        Metrics
      </button>
      {open && (
        <div className="bk-absolute bk-right-0 bk-z-30 bk-mt-2 bk-w-64 bk-rounded-xl bk-border bk-border-brand-ring/40 bk-bg-brand-panel bk-p-3 bk-text-xs bk-text-brand-muted bk-shadow-sm">
          <ul className="bk-space-y-2">
            {Object.entries(METRIC_DICTIONARY).map(([key, entry]) => (
              <li key={key}>
                <p className="bk-text-sm bk-font-medium bk-text-brand-text">{entry.title}</p>
                <p className="bk-text-xs bk-text-brand-muted">{entry.description}</p>
                <p className="bk-text-[11px] bk-text-brand-muted">{entry.formula}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
