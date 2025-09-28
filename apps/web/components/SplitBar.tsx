'use client';

import type { RewardSplit } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

const COLORS: Record<string, string> = {
  CREATOR: "bk-bg-brand-orange/80",
  BOOSTER: "bk-bg-brand-blue/70",
  TRADER: "bk-bg-brand-surface",
  TOTAL: "bk-bg-brand-blue/40"
};

export function SplitBar({ data }: { data: RewardSplit[] }) {
  const total = data.reduce((sum, entry) => sum + entry.reward, 0) || 1;
  return (
    <div className="bk-flex bk-h-3 bk-w-full bk-overflow-hidden bk-rounded bk-bg-brand-surface">
      {data.map((entry) => {
        const width = `${(entry.reward / total) * 100}%`;
        const color = COLORS[entry.bucket] ?? "bk-bg-accent/60";
        return (
          <div
            key={entry.bucket}
            className={`bk-h-full ${color}`}
            style={{ width }}
            title={`${entry.bucket}: ${formatMoney(entry.reward)}`}
          />
        );
      })}
    </div>
  );
}
