"use client";

import { useRef } from "react";
import type { FormBlock } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { dropBlockAt, isAttentionCheck } from "@/lib/forms/builder-blocks";
import type { BuilderEditor } from "../hooks/use-builder-editor";
import { useFlipLayout } from "../hooks/use-flip-layout";
import { gripProps, useReorderDrag, type DropTarget } from "../hooks/use-reorder-drag";
import { AttentionChip, GripIcon, SectionPill, TypeChip } from "./BuilderBits";

/**
 * Mobile builder list (Figma 13e 69:78): compact rows, drag by the grip to
 * reorder ("Nhấn giữ nút kéo để đổi thứ tự"), tap a row to edit it.
 */
export function MobileBlockList({ editor, onOpen }: { editor: BuilderEditor; onOpen: (blockId: string) => void }) {
  const { doc, readOnly } = editor;
  const listRef = useRef<HTMLDivElement>(null);
  const numberOf = new Map(doc.blocks.map((block, i) => [block.id, i + 1]));
  const drag = useReorderDrag(
    listRef,
    (blockId, target: DropTarget) => {
      editor.change(
        (current) => dropBlockAt(current, blockId, target.sectionId, target.index),
        `Đã chuyển câu hỏi tới vị trí câu ${Math.min(target.number, doc.blocks.length)}.`,
      );
    },
    { halfGap: 4 },
  );
  useFlipLayout(listRef);

  const row = (block: FormBlock, sectionId: string | null, index: number) => {
    const number = numberOf.get(block.id) ?? 0;
    const pending = editor.pending.some((item) => item.blockId === block.id);
    const phase = drag.dragging?.blockId === block.id ? drag.dragging.phase : null;
    const issues = editor.issues.blocks[block.id];
    return (
      <div key={block.id} data-flip={block.id}>
        <div
          data-drop-card={block.id}
          data-section={sectionId ?? ""}
          data-index={index}
          data-number={number}
          {...(readOnly ? {} : drag.dragProps(block.id))}
          className={`relative flex items-center rounded-[14px] bg-surface select-none ${
            pending
              ? "border border-dashed border-tone-amber-strong bg-tone-amber-tint"
              : issues
                ? "border border-danger"
                : "border border-line"
          } ${readOnly ? "" : "cursor-grab"} ${phase === "drag" ? "opacity-40" : phase === "settle" ? "opacity-0" : ""}`}
        >
          {!readOnly ? (
            <span {...gripProps} aria-hidden="true" className="flex h-full w-8 shrink-0 items-center justify-center self-stretch">
              <GripIcon />
            </span>
          ) : (
            <span className="w-3" />
          )}
          <button type="button" onClick={() => onOpen(block.id)} className="flex min-w-0 flex-1 cursor-[inherit] items-center gap-2 py-2.5 pr-3 text-left">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12px] font-extrabold text-ink-muted">{number}</span>
                <TypeChip type={block.type} compact />
                {pending || isAttentionCheck(block) ? <AttentionChip short /> : null}
              </span>
              <span className="mt-1 block text-body leading-[20.3px] font-bold text-ink">
                {block.title}
                {block.required ? <span className="text-danger"> *</span> : null}
              </span>
              {issues ? <span className="mt-1 block text-caption text-danger">{issues[0]}</span> : null}
            </span>
            <Icon name="chevron-right" size={18} className="shrink-0 text-ink-muted" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div ref={listRef} className="relative flex flex-col gap-2">
      {drag.target ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 right-0 left-0 z-10 transition-[translate] duration-150 ease-out"
          style={{ translate: `0 ${drag.target.y - 1.5}px` }}
        >
          <div className="drop-indicator-in h-0.75 rounded-full bg-primary" />
        </div>
      ) : null}
      {doc.sections.length === 0 ? (
        doc.blocks.map((block, i) => row(block, null, i))
      ) : (
        doc.sections.map((section, sectionIndex) => (
          <section key={section.id} aria-label={`Phần ${sectionIndex + 1}: ${section.title}`} className="flex flex-col gap-2">
            <div data-flip={`section:${section.id}`} className="mt-2 flex items-center gap-2">
              <SectionPill number={sectionIndex + 1} small />
              <span className="truncate text-body font-extrabold text-ink">{section.title}</span>
            </div>
            {section.blockIds.length === 0 ? (
              <div
                data-flip={`empty:${section.id}`}
                data-drop-empty=""
                data-section={section.id}
                data-index={0}
                data-number={doc.sections.slice(0, sectionIndex).reduce((n, s) => n + s.blockIds.length, 0) + 1}
                className="rounded-[14px] border border-dashed border-line-strong px-4 py-3 text-caption text-ink-muted"
              >
                Phần này chưa có câu hỏi.
              </div>
            ) : (
              section.blockIds.map((id, i) => row(doc.blocks.find((b) => b.id === id) as FormBlock, section.id, i))
            )}
          </section>
        ))
      )}
    </div>
  );
}
