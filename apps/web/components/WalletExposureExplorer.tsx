'use client';

import { useEffect, useMemo, useState, useTransition } from "react";
import type { BoostLedgerRow, WalletExposureRow } from "@/lib/db";
import { formatDateTime, formatMoney } from "@/lib/fmt";

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
        <div className="bk-rounded-2xl bk-bg-brand-surface bk-border bk-border-brand-ring/40 bk-p-4 bk-space-y-3">
          <div className="bk-flex bk-items-center bk-justify-between">
            <span className="bk-text-xs bk-text-brand-muted">Wallets</span>
            {loadingExposure && <span className="bk-text-2xs bk-text-brand-muted">Refreshing…</span>}
          </div>
          <div className="bk-max-h-[360px] bk-overflow-auto bk-rounded-xl bk-border bk-border-brand-ring/30">
            <table className="bk-w-full bk-text-xs bk-text-brand-muted bk-table-fixed">
              <thead className="bk-sticky bk-top-0 bk-bg-brand-surface">
                <tr className="bk-text-2xs bk-uppercase bk-text-brand-muted">
                  <th className="bk-text-left bk-font-medium bk-px-3 bk-py-2">Wallet</th>
                  <th className="bk-text-right bk-font-medium bk-px-3 bk-py-2">Outstanding</th>
                  <th className="bk-text-right bk-font-medium bk-px-3 bk-py-2">Paid</th>
                  <th className="bk-text-right bk-font-medium bk-px-3 bk-py-2">Subsidy</th>
                  <th className="bk-text-right bk-font-medium bk-px-3 bk-py-2">Volume</th>
                </tr>
              </thead>
              <tbody>
                {exposureRows.map((row) => {
                  const isActive = row.addr === activeAddress;
                  return (
                    <tr
                      key={row.addr}
                      className={`bk-cursor-pointer hover:bk-bg-brand-blue/10 ${isActive ? "bk-bg-brand-blue/15" : ""}`}
                      onClick={() => selectAddress(row.addr)}
                    >
                      <td className="bk-px-3 bk-py-2 bk-font-mono bk-text-brand-text bk-break-all">{row.addr}</td>
                      <td className="bk-text-right bk-px-3 bk-py-2">{formatMoney(row.outstandingBoost)}</td>
                      <td className="bk-text-right bk-px-3 bk-py-2">{formatMoney(row.boostPaid)}</td>
                      <td className="bk-text-right bk-px-3 bk-py-2">{formatMoney(row.subsidy)}</td>
                      <td className="bk-text-right bk-px-3 bk-py-2">{formatMoney(row.tradeVolume)}</td>
                    </tr>
                  );
                })}
                {exposureRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="bk-px-3 bk-py-6 bk-text-center">No boost activity captured yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bk-rounded-2xl bk-bg-brand-surface bk-border bk-border-brand-ring/40 bk-p-4 bk-space-y-3">
          <div className="bk-flex bk-items-center bk-justify-between">
            <div>
              <h3 className="bk-text-xs bk-text-brand-muted">Boost ledger</h3>
              {activeAddress ? (
                <p className="bk-text-2xs bk-text-brand-muted bk-font-mono bk-break-all">{activeAddress}</p>
              ) : (
                <p className="bk-text-2xs bk-text-brand-muted">Select a wallet to inspect ledger activity.</p>
              )}
            </div>
            {loadingLedger && <span className="bk-text-2xs bk-text-brand-muted">Loading…</span>}
          </div>
          <div className="bk-max-h-[360px] bk-overflow-auto bk-space-y-2">
            {ledgerRows.map((entry) => (
              <div
                key={`${entry.marketId}-${entry.ts}`}
                className="bk-rounded-xl bk-border bk-border-brand-ring/30 bk-bg-brand-panel bk-p-3 bk-space-y-2"
              >
                <div className="bk-flex bk-items-center bk-justify-between">
                  <a
                    href={`https://context.markets/markets/${entry.marketId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="bk-text-brand-blue hover:bk-text-brand-text"
                  >
                    {entry.marketId}
                  </a>
                  <span className="bk-text-2xs bk-text-brand-muted">{formatDateTime(entry.ts)}</span>
                </div>
                <div className="bk-grid bk-grid-cols-2 bk-gap-2 bk-text-2xs bk-text-brand-muted">
                  <Metric label="Sets" value={formatMoney(entry.setsAmount)} />
                  <Metric label="Paid" value={formatMoney(entry.userPaid)} />
                  <Metric label="Subsidy" value={formatMoney(entry.subsidyUsed)} />
                  <Metric label="Actual" value={formatMoney(entry.actualCost)} />
                </div>
              </div>
            ))}
            {ledgerRows.length === 0 && activeAddress && (
              <div className="bk-rounded-xl bk-border bk-border-brand-ring/30 bk-bg-brand-panel bk-p-3 bk-text-2xs bk-text-brand-muted">
                No boost events recorded for this wallet.
              </div>
            )}
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
