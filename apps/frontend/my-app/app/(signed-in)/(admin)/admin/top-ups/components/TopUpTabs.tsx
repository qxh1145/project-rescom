"use client";
import { useRef, type KeyboardEvent } from "react";
export type ConsoleTab = "payos" | "refunds" | "action" | "manual";
const tabs: { id: ConsoleTab; label: string }[] = [
  { id: "payos", label: "Giao dịch PayOS" },
  { id: "refunds", label: "Yêu cầu hoàn tiền" },
  { id: "action", label: "Cần xử lý" },
  { id: "manual", label: "Lịch sử thủ công (cũ)" },
];
export function TopUpTabs({ active, counts, failed, onSelect }: { active: ConsoleTab; counts: { payos: number; manual: number; actionRequired: number; refunds?: number } | null; failed?: boolean; onSelect: (tab: ConsoleTab) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); onSelect(tabs[next].id); refs.current[next]?.focus();
  }
  return <div role="tablist" aria-label="Loại giao dịch nạp điểm" className="flex gap-6 overflow-x-auto border-b border-line">
    {tabs.map((tab, i) => <button key={tab.id} type="button" role="tab" id={`top-ups-${tab.id}-tab`}
      ref={node => { refs.current[i] = node; }} aria-controls={`top-ups-${tab.id}-panel`} aria-selected={active === tab.id}
      tabIndex={active === tab.id ? 0 : -1} onClick={() => onSelect(tab.id)} onKeyDown={e => keyDown(e, i)}
      className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2 pb-3 text-sm ${active === tab.id ? "border-primary font-bold text-primary-strong" : "border-transparent text-ink-muted hover:text-ink"}`}>
      {tab.label} <span className="ml-1 rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-ink-muted">{counts?.[tab.id === "action" ? "actionRequired" : tab.id] ?? (failed ? "—" : "…")}</span>
    </button>)}
  </div>;
}
