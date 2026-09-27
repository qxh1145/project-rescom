"use client";

import { useRef, type KeyboardEvent } from "react";
import type { DisputeCaseKind } from "@/lib/admin/disputes-service";
import { DISPUTE_TABS } from "@/lib/admin/disputes-view";

export const DISPUTE_PANEL_ID = "dispute-panel";

export function disputeTabId(kind: DisputeCaseKind): string {
  return `dispute-tab-${kind}`;
}

interface DisputeTabsProps {
  active: DisputeCaseKind;
  counts: Record<DisputeCaseKind, number> | undefined;
  onSelect: (kind: DisputeCaseKind) => void;
}

/**
 * Header tabs of Figma 11c (62:1662–1665): "Khiếu nại lượt làm · 1",
 * "Báo thiếu mã · 1", "Lượt bị khoá · 0". Rendered inside `AdminPage`'s meta
 * paragraph, hence phrasing elements only (span + button). Arrow keys move
 * between tabs (roving tabindex).
 */
export function DisputeTabs({ active, counts, onSelect }: DisputeTabsProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = DISPUTE_TABS.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    onSelect(DISPUTE_TABS[next].kind);
    refs.current[next]?.focus();
  }

  return (
    <span role="tablist" aria-label="Loại khiếu nại" className="ml-4.5 inline-flex flex-wrap gap-1.5">
      {DISPUTE_TABS.map((tab, index) => {
        const selected = tab.kind === active;
        const count = counts?.[tab.kind];
        return (
          <button
            key={tab.kind}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={disputeTabId(tab.kind)}
            aria-selected={selected}
            aria-controls={DISPUTE_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.kind)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={[
              "h-10 whitespace-nowrap rounded-[10px] px-4 text-[14px] transition-colors",
              selected ? "bg-tone-green-bg font-bold text-primary-strong" : "font-semibold text-ink hover:bg-surface-subtle",
            ].join(" ")}
          >
            {tab.label}
            {count === undefined ? null : ` · ${count}`}
          </button>
        );
      })}
    </span>
  );
}
