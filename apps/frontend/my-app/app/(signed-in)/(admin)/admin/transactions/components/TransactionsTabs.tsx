"use client";

import { useRef, type KeyboardEvent } from "react";
import { TRANSACTIONS_TABS, type TransactionsTab } from "@/lib/admin/ledger-ops-view";

export const TRANSACTIONS_PANEL_ID = "transactions-panel";

export function transactionsTabId(tab: TransactionsTab): string {
  return `transactions-tab-${tab}`;
}

export function transactionsPanelId(tab: TransactionsTab): string {
  return `${TRANSACTIONS_PANEL_ID}-${tab}`;
}

interface TransactionsTabsProps {
  active: TransactionsTab;
  onSelect: (tab: TransactionsTab) => void;
}

/**
 * Story 14.4 (AC 1): "Sổ giao dịch" / "Vận hành". Same mechanics as `DisputeTabs`:
 * rendered inside `AdminPage`'s meta paragraph (phrasing elements only), Arrow keys,
 * Home and End move between tabs (roving tabindex).
 */
export function TransactionsTabs({ active, onSelect }: TransactionsTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = TRANSACTIONS_TABS.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(TRANSACTIONS_TABS[next].key);
    refs.current[next]?.focus();
  }

  return (
    <span role="tablist" aria-label="Giao dịch điểm" className="inline-flex flex-wrap gap-1.5 align-middle">
      {TRANSACTIONS_TABS.map((tab, index) => {
        const selected = tab.key === active;
        return (
          <button
            key={tab.key}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={transactionsTabId(tab.key)}
            aria-selected={selected}
            aria-controls={transactionsPanelId(tab.key)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.key)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={[
              "h-10 whitespace-nowrap rounded-[10px] px-4 text-[14px] transition-colors",
              selected ? "bg-tone-green-bg font-bold text-primary-strong" : "font-semibold text-ink hover:bg-surface-subtle",
            ].join(" ")}
          >
            {tab.label}
          </button>
        );
      })}
    </span>
  );
}
