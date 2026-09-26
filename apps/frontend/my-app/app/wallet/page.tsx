"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { WalletDetailsDto } from "@rescom/schemas";
import { fetchWalletDetails } from "./wallet-api";

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateString).toLocaleDateString();
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletDetailsDto | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [filterClass, setFilterClass] = useState<string>("ALL");

  const refreshWallet = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadData() {
      try {
        const data = await fetchWalletDetails({ signal: controller.signal });
        if (active) {
          setWallet(data);
          setError(null);
        }
      } catch (err: unknown) {
        if (active && !(err instanceof DOMException && err.name === "AbortError")) {
          const msg =
            err instanceof Error ? err.message : "Failed to load wallet details";
          setError(msg);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const filteredTransactions = (wallet?.transactions || []).filter((tx) => {
    if (filterClass === "ALL") return true;
    return tx.accountClass === filterClass;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-white">
              Points Wallet & Balances
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              Double-Entry Ledger
            </span>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Track spendable balances, escrow reservations, pending rewards, and immutable transaction history.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/marketplace"
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Marketplace Feed
          </Link>
          <Link
            href="/forms"
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Publisher Surveys
          </Link>
          <Link
            href="/wallet"
            className="px-3.5 py-2 text-xs font-medium rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            My Wallet
          </Link>
          <Link
            href="/wallet/top-up"
            className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
          >
            + Nạp điểm
          </Link>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-red-600 dark:text-red-400 text-sm font-medium">
              {error}
            </span>
          </div>
          <button
            onClick={refreshWallet}
            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state skeleton */}
      {loading && !wallet && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-32 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse border border-zinc-200 dark:border-zinc-800"
              />
            ))}
          </div>
          <div className="h-64 rounded-xl bg-zinc-100 dark:bg-zinc-800/50 animate-pulse" />
        </div>
      )}

      {wallet && (
        <div className="space-y-8">
          {/* Total Points Hero Bar */}
          <div className="p-6 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-800 text-white dark:from-zinc-900 dark:to-zinc-950 border border-zinc-800 shadow-sm flex flex-wrap items-center justify-between gap-6">
            <div>
              <span className="text-xs font-semibold tracking-wider uppercase text-zinc-400">
                Total System Position
              </span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-4xl font-extrabold tracking-tight">
                  {wallet.balance.total.toLocaleString()}
                </span>
                <span className="text-sm font-semibold text-zinc-400">
                  POINTS
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-1">
                Combined balance across all five personal account tiers.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/marketplace"
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white transition-colors shadow-sm"
              >
                + Earn Points
              </Link>
              <Link
                href="/forms/new"
                className="px-4 py-2.5 text-xs font-semibold rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 transition-colors"
              >
                Create Survey
              </Link>
            </div>
          </div>

          {/* 5 Distinct Balance Cards (FR-31) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* 1. Available Balance */}
            <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border-2 border-emerald-500/30 dark:border-emerald-500/20 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Available
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                  Spendable
                </span>
              </div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                {wallet.balance.available.toLocaleString()}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
                Ready to spend on publishing surveys (points cannot be cashed out).
              </p>
            </div>

            {/* 2. Pending Balance */}
            <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Pending
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                  48h Window
                </span>
              </div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                {wallet.balance.pending.toLocaleString()}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
                External survey completions awaiting release.
              </p>
            </div>

            {/* 3. Escrowed Points */}
            <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Escrowed
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800">
                  Locked
                </span>
              </div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                {wallet.balance.escrow.toLocaleString()}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
                Reserved for participant rewards in active surveys.
              </p>
            </div>

            {/* 4. Frozen Points */}
            <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Frozen
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800">
                  Onboarding
                </span>
              </div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                {wallet.balance.frozen.toLocaleString()}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
                Điểm tân thủ mở khóa khi hoàn tất khảo sát nhân khẩu học và 1 khảo sát trên Chợ khảo sát trong 30 ngày.
              </p>
            </div>

            {/* 5. Integrity Hold */}
            <div className="p-5 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                  Integrity Hold
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-800">
                  Quality Audit
                </span>
              </div>
              <div className="text-2xl font-bold text-zinc-900 dark:text-white">
                {wallet.balance.integrityHold.toLocaleString()}
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-2 leading-relaxed">
                Non-spendable hold during integrity evaluation.
              </p>
            </div>
          </div>

          {/* Balance Guide Accordion / Information (FR-31) */}
          <div className="p-5 rounded-2xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-2 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Understanding Your Balance Tiers (FR-31)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed mt-3">
              <div>
                <strong className="text-zinc-800 dark:text-zinc-200 font-medium">
                  Available (Spendable):
                </strong>{" "}
                Points ready to fund new survey respondent pools.
              </div>
              <div>
                <strong className="text-zinc-800 dark:text-zinc-200 font-medium">
                  Pending (48h Window):
                </strong>{" "}
                External survey earnings awaiting automatic 48-hour clearance.
              </div>
              <div>
                <strong className="text-zinc-800 dark:text-zinc-200 font-medium">
                  Escrowed (Locked):
                </strong>{" "}
                Points locked to guarantee participant payouts for your active surveys.
              </div>
              <div>
                <strong className="text-zinc-800 dark:text-zinc-200 font-medium">
                  Frozen (Onboarding):
                </strong>{" "}
                Điểm tân thủ mở khóa khi hoàn tất khảo sát nhân khẩu học và 1 khảo sát trên Chợ khảo sát trong 30 ngày.
              </div>
              <div className="md:col-span-2">
                <strong className="text-zinc-800 dark:text-zinc-200 font-medium">
                  Integrity Hold (Quality Review):
                </strong>{" "}
                Reserved points held during automated telemetry verification or manual audit.
              </div>
            </div>
          </div>

          {/* Transaction History Section */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-zinc-900 dark:text-white">
                  Ledger Transaction History
                </h2>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                  Append-only immutable record of all point credits and debits.
                </p>
              </div>

              {/* Account Filter */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  Filter:
                </span>
                <select
                  value={filterClass}
                  onChange={(e) => setFilterClass(e.target.value)}
                  aria-label="Filter transactions by account class"
                  className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                >
                  <option value="ALL">All Account Classes</option>
                  <option value="USER_AVAILABLE">Available</option>
                  <option value="PENDING">Pending</option>
                  <option value="ESCROW">Escrow</option>
                  <option value="FROZEN">Frozen</option>
                  <option value="INTEGRITY_HOLD">Integrity Hold</option>
                </select>
              </div>
            </div>

            {/* Transactions Table */}
            {filteredTransactions.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 mb-3">
                  <svg
                    aria-hidden="true"
                    className="w-6 h-6"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <h4 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  No transactions found
                </h4>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 max-w-sm mx-auto">
                  {filterClass === "ALL"
                    ? "You haven't participated in any point transfers yet. Visit the Marketplace to take surveys and earn rewards."
                    : `No transactions found under the ${filterClass} account class.`}
                </p>
                {filterClass === "ALL" && (
                  <Link
                    href="/marketplace"
                    className="inline-block mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 hover:opacity-90 transition-opacity"
                  >
                    Go to Marketplace
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="w-full text-left text-xs"
                  aria-label="Ledger transaction history"
                >
                  <thead className="bg-zinc-50 dark:bg-zinc-800/50 text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Date & Time</th>
                      <th className="py-3 px-4 font-semibold">Account Tier</th>
                      <th className="py-3 px-4 font-semibold">Description</th>
                      <th className="py-3 px-4 font-semibold">Reference ID</th>
                      <th className="py-3 px-4 font-semibold text-right">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-zinc-800 dark:text-zinc-200">
                    {filteredTransactions.map((tx) => {
                      return (
                        <tr
                          key={tx.id}
                          className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30 transition-colors"
                        >
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="font-medium text-zinc-800 dark:text-zinc-200">
                                {formatRelativeTime(tx.createdAt)}
                              </span>
                              <span className="text-[10px] text-zinc-400">
                                {new Date(tx.createdAt).toLocaleDateString()}{" "}
                                {new Date(tx.createdAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                              {tx.accountClass}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 font-medium">
                            <div className="flex items-center gap-1.5">
                              {tx.reversesJournalId && (
                                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300">
                                  REVERSAL
                                </span>
                              )}
                              <span>{tx.description || "Point Movement"}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[11px] text-zinc-400 max-w-[160px] truncate" title={tx.idempotencyKey}>
                            {tx.idempotencyKey}
                          </td>
                          <td className="py-3.5 px-4 text-right font-bold whitespace-nowrap">
                            {tx.amount > 0 ? (
                              <span className="text-emerald-600 dark:text-emerald-400">
                                +{tx.amount} PTS
                              </span>
                            ) : tx.amount < 0 ? (
                              <span className="text-rose-600 dark:text-rose-400">
                                {tx.amount} PTS
                              </span>
                            ) : (
                              <span className="text-zinc-500 dark:text-zinc-400">
                                0 PTS
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
