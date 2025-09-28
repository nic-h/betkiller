'use client';

import { useEffect, useMemo, useState, useTransition } from "react";
import type { BoostLedgerRow, WalletExposureRow } from "@/lib/db";
import { formatMoney } from "@/lib/fmt";

export function WalletExposureExplorer({
  initialExposure,
  initialLedger,
  initialAddress
}: {
  initialExposure: WalletExposureRow[];
  initialLedger: BoostLedgerRow[];
  initialAddress: string | null;
}) {
  const [exposureRows, setExposureRows] = useState(initialExposure);
  const [selectedAddress, setSelectedAddress] = useState(initialAddress ?? (initialExposure[0]?.addr ?? null));
  const [ledgerRows, setLedgerRows] = useState(initialLedger);
  const [loadingExposure, startExposureTransition] = useTransition();
  const [loadingLedger, startLedgerTransition] = useTransition();

  useEffect(() => {
    if (!selectedAddress) {
      setLedgerRows([]);
    }
  }, [selectedAddress]);

  const refreshExposure = () => {
    startExposureTransition(() => {
      fetch(`/api/wallet-exposure`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
        .then((payload) => {
          if (Array.isArray(payload?.rows)) {
            setExposureRows(payload.rows as WalletExposureRow[]);
          }
        })
        .catch(() => {});
    });
  };

  const selectAddress = (addr: string) => {
    if (addr === selectedAddress) return;
    setSelectedAddress(addr);
    startLedgerTransition(() => {
      fetch(`/api/wallet-exposure/${addr}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("failed"))))
        .then((payload) => {
          if (Array.isArray(payload?.rows)) {
            setLedgerRows(payload.rows as BoostLedgerRow[]);
          } else {
            setLedgerRows([]);
          }
        })
        .catch(() => {
          setLedgerRows([]);
        });
    });
  };

  const activeAddress = useMemo(() => selectedAddress ?? exposureRows[0]?.addr ?? null, [selectedAddress, exposureRows]);

  return (
    <section className="bk-rounded-2xl bk-bg-brand-panel bk-ring-1 bk-ring-brand-ring/60 bk-p-5 bk-space-y-4">
      <header className="bk-flex bk-flex-wrap bk-items-center bk-justify-between bk-gap-2">
        <div className="bk-space-y-1">
          <h2 className="bk-text-sm bk-text-brand-muted">Wallet exposure explorer</h2>
          <p className="bk-text-2xs bk-text-brand-muted">Outstanding boosts and claim spend by wallet</p>
        </div>
        <button
          type="button"
          onClick={refreshExposure}
          className="bk-rounded-full bk-border bk-border-brand-ring/40 bk-px-3 bk-py-1 bk-text-2xs bk-text-brand-muted hover:bk-text-brand-text"
          aria-label="Refresh exposures"
        >
          {loadingExposure ? "Refreshing…" : "Refresh"}
        </button>
      </header>
      <div className="bk-grid bk-grid-cols-1 xl:bk-grid-cols-2 bk-gap-4">
        <div className="bk-space-y-2">
          <table className="bk-w-full bk-text-xs bk-text-brand-muted">
            <thead>
              <tr className="bk-text-2xs bk-uppercase bk-text-brand-muted">
                <th className="bk-text-left bk-font-medium">Wallet</th>
                <th className="bk-text-right bk-font-medium">Outstanding</th>
                <th className="bk-text-right bk-font-medium">Paid</th>
                <th className="bk-text-right bk-font-medium">Subsidy</th>
                <th className="bk-text-right bk-font-medium">Volume</th>
              </tr>
            </thead>
            <tbody>
              {exposureRows.map((row) => {
                const isActive = row.addr === activeAddress;
                return (
                  <tr
                    key={row.addr}
                    className={`bk-cursor-pointer hover:bk-bg-brand-ring/30 ${isActive ? "bk-bg-brand-ring/30" : ""}`}
                    onClick={() => selectAddress(row.addr)}
                  >
                    <td className="bk-py-2 bk-pr-2 bk-font-mono bk-text-brand-text">{row.addr}</td>
                    <td className="bk-text-right bk-py-2">{formatMoney(row.outstandingBoost)}</td>
                    <td className="bk-text-right bk-py-2">{formatMoney(row.boostPaid)}</td>
                    <td className="bk-text-right bk-py-2">{formatMoney(row.subsidy)}</td>
                    <td className="bk-text-right bk-py-2">{formatMoney(row.tradeVolume)}</td>
                  </tr>
                );
              })}
              {exposureRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="bk-py-4 bk-text-center">No boost activity captured yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="bk-space-y-3">
          <div className="bk-flex bk-items-center bk-justify-between">
            <h3 className="bk-text-xs bk-text-brand-muted">Boost ledger</h3>
            {loadingLedger && <span className="bk-text-2xs bk-text-brand-muted">Loading…</span>}
          </div>
          <div className="bk-space-y-2 bk-text-xs bk-text-brand-muted">
            {activeAddress ? (
              <p className="bk-text-2xs bk-text-brand-muted">{activeAddress}</p>
            ) : (
              <p className="bk-text-2xs bk-text-brand-muted">Select a wallet to inspect ledger activity.</p>
            )}
            <ul className="bk-space-y-2">
              {ledgerRows.map((entry) => (
                <li key={`${entry.marketId}-${entry.ts}`} className="bk-rounded-xl bk-border bk-border-brand-ring/30 bk-bg-brand-surface bk-p-3">
                  <div className="bk-flex bk-items-center bk-justify-between">
                    <a
                      href={`https://context.markets/markets/${entry.marketId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="bk-text-brand-text hover:bk-text-brand-blue"
                    >
                      {entry.marketId}
                    </a>
                    <span className="bk-text-2xs bk-text-brand-muted">{new Date(entry.ts * 1000).toLocaleString()}</span>
                  </div>
                  <div className="bk-grid bk-grid-cols-2 bk-gap-2 bk-text-2xs bk-text-brand-muted bk-mt-2">
                    <Metric label="Sets" value={formatMoney(entry.setsAmount)} />
                    <Metric label="Paid" value={formatMoney(entry.userPaid)} />
                    <Metric label="Subsidy" value={formatMoney(entry.subsidyUsed)} />
                    <Metric label="Actual" value={formatMoney(entry.actualCost)} />
                  </div>
                </li>
              ))}
              {ledgerRows.length === 0 && activeAddress && (
                <li className="bk-rounded-xl bk-border bk-border-brand-ring/30 bk-bg-brand-surface bk-p-3 bk-text-2xs bk-text-brand-muted">
                  No boost events recorded for this wallet.
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="bk-text-[10px] bk-uppercase bk-text-brand-muted">{label}</p>
      <p className="bk-text-xs bk-text-brand-text bk-tabular-nums">{value}</p>
    </div>
  );
}
