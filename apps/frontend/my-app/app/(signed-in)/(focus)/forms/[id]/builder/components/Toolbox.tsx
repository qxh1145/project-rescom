"use client";

import { useState, type DragEvent } from "react";
import type { FormBlockType } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { SECTION_TOOL, TOOLBOX_CATEGORIES, searchBlockTypes } from "@/lib/forms/builder-catalog";
import { GripIcon } from "./BuilderBits";

export const BLOCK_TYPE_MIME = "application/x-rescom-block-type";

interface ToolboxProps {
  disabled: boolean;
  draggingType: FormBlockType | null;
  onAdd: (type: FormBlockType) => void;
  onAddSection: () => void;
  onDragStart: (type: FormBlockType) => void;
  onDragEnd: () => void;
}

function ToolItem({
  icon,
  label,
  disabled,
  onActivate,
  drag,
}: {
  icon: string;
  label: string;
  disabled: boolean;
  onActivate: () => void;
  drag?: { onDragStart: (event: DragEvent<HTMLButtonElement>) => void; onDragEnd: () => void };
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        draggable={Boolean(drag) && !disabled}
        onDragStart={drag?.onDragStart}
        onDragEnd={drag?.onDragEnd}
        onClick={onActivate}
        className="flex h-12 w-full items-center gap-2.5 rounded-field border border-line bg-surface pr-3 pl-1.5 text-left text-body-sm font-semibold text-ink transition-colors hover:border-primary hover:bg-tone-green-tint disabled:opacity-60"
      >
        <GripIcon size={16} />
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-subtle">
          <Icon name={icon} size={18} />
        </span>
        {label}
      </button>
    </li>
  );
}

/**
 * Figma 13 "Khối câu hỏi" aside (63:4256): search, one group per category,
 * each type draggable onto the canvas or added with a click / Enter ("thêm
 * vào cuối phần đang chọn"). While dragging, the item shows "Đang kéo …".
 */
export function Toolbox({ disabled, draggingType, onAdd, onAddSection, onDragStart, onDragEnd }: ToolboxProps) {
  const [query, setQuery] = useState("");
  const matches = searchBlockTypes(query);
  const showSection = !query.trim() || "phan moi bo cuc section".includes(query.trim().toLowerCase());

  return (
    <nav aria-label="Khối câu hỏi" data-tour="builder-toolbox" className="flex flex-col px-4 pt-4 pb-6">
      <label className="relative block">
        <span className="sr-only">Tìm loại câu hỏi</span>
        <Icon name="search" size={18} className="pointer-events-none absolute top-3 left-3 text-ink-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tìm loại câu hỏi"
          className="h-11 w-full rounded-field border border-line-strong bg-surface pr-3 pl-10 text-body-sm text-ink placeholder:text-ink-placeholder focus:border-primary focus:ring-3 focus:ring-primary/20 focus:outline-none"
        />
      </label>
      <p className="mt-2.5 text-[12px] leading-[17.4px] text-ink-muted">
        Kéo vào form, hoặc nhấn Enter để thêm vào cuối phần đang chọn.
      </p>

      {TOOLBOX_CATEGORIES.map((category) => {
        const items = matches.filter((info) => info.category === category.id);
        if (items.length === 0) return null;
        return (
          <section key={category.id} aria-label={category.label} className="mt-4">
            <h2 className="text-[12px] font-bold tracking-[0.5px] text-ink-muted uppercase">{category.label}</h2>
            <ul className="mt-3 flex flex-col gap-1.5">
              {items.map((info) =>
                draggingType === info.type ? (
                  <li
                    key={info.type}
                    className="flex h-12.5 items-center rounded-field border-2 border-dashed border-primary bg-tone-green-tint px-3 text-caption font-semibold text-primary"
                  >
                    Đang kéo &ldquo;{info.label}&rdquo;…
                  </li>
                ) : (
                  <ToolItem
                    key={info.type}
                    icon={info.icon}
                    label={info.label}
                    disabled={disabled}
                    onActivate={() => onAdd(info.type)}
                    drag={{
                      onDragStart: (event) => {
                        event.dataTransfer.setData(BLOCK_TYPE_MIME, info.type);
                        event.dataTransfer.setData("text/plain", info.label);
                        event.dataTransfer.effectAllowed = "copy";
                        onDragStart(info.type);
                      },
                      onDragEnd,
                    }}
                  />
                ),
              )}
            </ul>
          </section>
        );
      })}

      {showSection ? (
        <section aria-label={SECTION_TOOL.category} className="mt-4">
          <h2 className="text-[12px] font-bold tracking-[0.5px] text-ink-muted uppercase">{SECTION_TOOL.category}</h2>
          <ul className="mt-3">
            <ToolItem icon={SECTION_TOOL.icon} label={SECTION_TOOL.label} disabled={disabled} onActivate={onAddSection} />
          </ul>
        </section>
      ) : null}

      {matches.length === 0 && !showSection ? (
        <p className="mt-4 text-caption text-ink-muted" role="status">
          Không có loại câu hỏi nào khớp.
        </p>
      ) : null}
    </nav>
  );
}
