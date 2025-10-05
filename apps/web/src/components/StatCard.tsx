import type { ReactNode } from "react";

export type StatCardProps = {
  label: string;
  value: ReactNode;
};

export function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="bk-rounded-xl bk-border bk-border-slate-700 bk-bg-slate-900/70 bk-px-4 bk-py-3">
      <div className="bk-text-2xl bk-font-semibold bk-text-slate-100">{value}</div>
      <div className="bk-text-xs bk-uppercase bk-tracking-wide bk-text-slate-400">{label}</div>
    </div>
  );
}
