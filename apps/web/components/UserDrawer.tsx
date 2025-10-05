'use client';

import { useState } from "react";

import type { WalletSnapshot } from "@/lib/db";
import { usd } from "@/lib/num";

export function UserDrawer({ snapshot }: { snapshot: WalletSnapshot | null }) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className={`bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-3 bk-py-1.5 bk-text-xs bk-font-medium ${
        snapshot ? "bk-bg-brand-blue bk-text-black hover:bk-bg-brand-blue/90" : "bk-bg-brand-panel bk-text-brand-muted hover:bk-text-brand-text"
      }`}
    >
      {snapshot ? `${snapshot.address.slice(0, 6)}...${snapshot.address.slice(-4)}` : "Set BK_ME"}
    </button>
  );

  if (!snapshot) {
    return (
      <>
        {trigger}
        {open && (
          <div className="bk-fixed bk-inset-0 bk-z-50 bk-flex bk-justify-end">
            <div className="bk-fixed bk-inset-0 bk-bg-black/40" onClick={() => setOpen(false)} />
            <aside className="bk-relative bk-h-full bk-w-full bk-max-w-sm bk-bg-brand-panel bk-p-6 bk-shadow-2xl bk-ring-1 bk-ring-brand-ring/60">
              <header className="bk-flex bk-items-center bk-justify-between">
                <div className="bk-space-y-1">
                  <h2 className="bk-text-sm bk-font-medium bk-text-brand-text">Set BK_ME</h2>
                  <p className="bk-text-2xs bk-text-brand-muted">Add your wallet address to .env.local</p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-2 bk-py-1 bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
                >
                  Close
                </button>
              </header>
              <p className="bk-mt-6 bk-text-xs bk-text-brand-muted">
                Set <code className="bk-text-brand-text">BK_ME</code> in your environment to see personal capital, boosts, and ROI. The dash pulls directly from the SQLite snapshot at
                <code className="bk-ml-1 bk-text-brand-text">data/context.db</code>.
              </p>
            </aside>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {trigger}
      {open && (
        <div className="bk-fixed bk-inset-0 bk-z-50 bk-flex bk-justify-end">
          <div className="bk-fixed bk-inset-0 bk-bg-black/40" onClick={() => setOpen(false)} />
          <aside className="bk-relative bk-h-full bk-w-full bk-max-w-sm bk-bg-brand-panel bk-p-6 bk-shadow-2xl bk-ring-1 bk-ring-brand-ring/60">
            <header className="bk-flex bk-items-center bk-justify-between">
              <div className="bk-space-y-1">
                <h2 className="bk-text-sm bk-font-medium bk-text-brand-text">Wallet overview</h2>
                <p className="bk-text-2xs bk-text-brand-muted">Range-adjusted metrics</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-2 bk-py-1 bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
              >
                Close
              </button>
            </header>
            <div className="bk-mt-6 bk-space-y-4">
              <Metric label="Capital deployed" value={usd(snapshot.capitalAtRisk)} />
              <Metric label="Boost available" value={usd(snapshot.boostAvailable)} />
              <Metric label="Locked boost" value={usd(snapshot.boostLocked)} />
              <Metric label="PnL" value={usd(snapshot.pnl)} />
              <Metric label="Rewards" value={usd(snapshot.rewards)} />
              <Metric label="Net deployed" value={usd(snapshot.netDeployed)} />
              <Metric
                label="ROI"
                value={`${snapshot.roiPercent >= 0 ? "+" : ""}${snapshot.roiPercent.toFixed(2)}%`}
                subtitle={snapshot.roiRank > 0 ? `Platform ROI rank #${snapshot.roiRank}` : undefined}
              />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function Metric({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="bk-space-y-1">
      <p className="bk-text-2xs bk-text-brand-muted">{label}</p>
      <p className="bk-text-lg bk-tabular-nums bk-text-brand-text">{value}</p>
      {subtitle && <p className="bk-text-2xs bk-text-brand-muted">{subtitle}</p>}
    </div>
  );
}
