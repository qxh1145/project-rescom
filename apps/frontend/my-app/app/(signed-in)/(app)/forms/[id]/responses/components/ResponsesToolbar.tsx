"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { radioGroupKeyTarget } from "@/components/ui/radio-group-keys";
import type { ResultQuestion } from "@/lib/forms/results-service";
import { MAX_COLUMNS, QUALITY_FILTERS, type QualityCounts, type QualityFilter } from "@/lib/forms/results-view";

const FILTER_LABELS: Record<QualityFilter, string> = { all: "Tất cả", passed: "Đạt", review: "Cần xem lại" };

export function SearchBox({
  value,
  onChange,
  size,
}: {
  value: string;
  onChange: (value: string) => void;
  size: "desktop" | "mobile";
}) {
  const id = useId();
  const desktop = size === "desktop";
  return (
    <div className={`relative ${desktop ? "w-70" : "w-full"}`}>
      <label htmlFor={id} className="sr-only">
        Tìm theo mã hoặc nội dung
      </label>
      <Icon
        name="search"
        size={18}
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-muted ${desktop ? "left-3" : "left-3.5"}`}
      />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Tìm theo mã hoặc nội dung"
        className={`w-full rounded-field border border-line-strong bg-surface text-ink placeholder:text-ink-placeholder focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none ${
          desktop ? "h-11 pr-3 pl-10 text-body-sm" : "h-12 pr-3.5 pl-10.5 text-body"
        }`}
      />
    </div>
  );
}

/** Desktop "Lọc theo chất lượng" (63:3758): bordered track, active segment outlined in ink. */
export function QualitySegments({
  value,
  counts,
  onChange,
}: {
  value: QualityFilter;
  counts: QualityCounts;
  onChange: (value: QualityFilter) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = QUALITY_FILTERS.indexOf(value);
  return (
    <div
      role="radiogroup"
      aria-label="Lọc theo chất lượng"
      className="inline-flex h-11 items-center gap-0.5 rounded-field border border-line-strong bg-surface-subtle p-1"
    >
      {QUALITY_FILTERS.map((filter, index) => {
        const active = index === selected;
        return (
          <button
            key={filter}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(filter)}
            onKeyDown={(event) => {
              const target = radioGroupKeyTarget(event.key, index, QUALITY_FILTERS.length);
              if (target === null) return;
              event.preventDefault();
              refs.current[target]?.focus();
              onChange(QUALITY_FILTERS[target]);
            }}
            className={`h-8.5 whitespace-nowrap rounded-[9px] border px-3.5 text-[13px] transition-colors ${
              active
                ? "border-ink bg-surface font-bold text-ink"
                : "border-transparent font-semibold text-ink-strong hover:text-ink"
            }`}
          >
            {FILTER_LABELS[filter]} · {counts[filter]}
          </button>
        );
      })}
    </div>
  );
}

/** Mobile chips (63:4558–4564). */
export function QualityChips({
  value,
  counts,
  onChange,
}: {
  value: QualityFilter;
  counts: QualityCounts;
  onChange: (value: QualityFilter) => void;
}) {
  return (
    <div role="group" aria-label="Lọc theo chất lượng" className="flex flex-wrap gap-2">
      {QUALITY_FILTERS.map((filter) => (
        <ToggleChip key={filter} selected={value === filter} onSelectedChange={() => onChange(filter)} className="text-[14px]">
          {FILTER_LABELS[filter]} · {counts[filter]}
        </ToggleChip>
      ))}
    </div>
  );
}

/** "Cột · 3/8 câu" (63:3763): choose which questions the table shows (1–4). */
export function ColumnPicker({
  questions,
  columnIds,
  onChange,
}: {
  questions: readonly ResultQuestion[];
  columnIds: readonly string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (id: string, checked: boolean) => {
    const next = checked ? [...columnIds, id] : columnIds.filter((item) => item !== id);
    if (next.length === 0 || next.length > MAX_COLUMNS) return;
    onChange(next);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-11 items-center gap-2 rounded-field border border-line-strong bg-surface px-3.5 text-body-sm font-bold text-ink hover:bg-surface-subtle"
      >
        <Icon name="columns" size={16} />
        Cột · {columnIds.length}/{questions.length} câu
      </button>
      {open ? (
        <div
          id={panelId}
          className="absolute top-12 right-0 z-20 flex w-80 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[0_12px_24px_rgba(30,36,70,0.15)]"
        >
          <p className="text-caption text-ink-muted">Chọn tối đa {MAX_COLUMNS} câu hiện trong bảng.</p>
          {questions.map((question) => {
            const checked = columnIds.includes(question.id);
            return (
              <Checkbox
                key={question.id}
                id={`${panelId}-${question.id}`}
                checked={checked}
                disabled={(!checked && columnIds.length >= MAX_COLUMNS) || (checked && columnIds.length === 1)}
                onChange={(event) => toggle(question.id, event.target.checked)}
                label={
                  <span className="text-body-sm">
                    C{question.number} · {question.title}
                  </span>
                }
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
