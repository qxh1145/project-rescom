"use client";

import { useRef } from "react";
import type { FormBlock } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { dropBlockAt, isAttentionCheck } from "@/lib/forms/builder-blocks";
import type { BuilderEditor } from "../hooks/use-builder-editor";
import { useReorderDrag, type DropTarget } from "../hooks/use-reorder-drag";
import { AttentionChip, GripIcon, SectionPill, TypeChip } from "./BuilderBits";

/**
 * Mobile builder list (Figma 13e 69:78): compact rows, drag by the grip to
 * reorder ("Nhấn giữ nút kéo để đổi thứ tự"), tap a row to edit it.
 */
export function MobileBlockList({ editor, onOpen }: { editor: BuilderEditor; onOpen: (blockId: string) => void }) {
  const { doc, readOnly } = editor;
  const listRef = useRef<HTMLDivElement>(null);
  const numberOf = new Map(doc.blocks.map((block, i) => [block.id, i + 1]));
  const drag = useReorderDrag(listRef, (blockId, target: DropTarget) => {
    editor.change(
      (current) => dropBlockAt(current, blockId, target.sectionId, target.index),
      `Đã chuyển câu hỏi tới vị trí câu ${Math.min(target.number, doc.blocks.length)}.`,
    );
  });

  const row = (block: FormBlock, sectionId: string | null, index: number) => {
    const number = numberOf.get(block.id) ?? 0;
    const pending = editor.pending.some((item) => item.blockId === block.id);
    const offset = drag.dragging?.blockId === block.id ? drag.dragging.offsetY : null;
    const issues = editor.issues.blocks[block.id];
    return (
      <div key={block.id}>
        {drag.target?.beforeBlockId === block.id ? <div className="mb-2 h-0.75 rounded-full bg-primary" aria-hidden="true" /> : null}
        <div
          data-drop-card={block.id}
          data-section={sectionId ?? ""}
          data-index={index}
          data-number={number}
          className={`relative flex items-center rounded-[14px] bg-surface ${
            offset !== null
              ? "z-20 border-2 border-primary shadow-[0_14px_14px_rgba(30,36,70,0.22)]"
              : pending
                ? "border border-dashed border-tone-amber-strong bg-tone-amber-tint"
                : issues
                  ? "border border-danger"
                  : "border border-line"
          }`}
          style={offset !== null ? { transform: `translateY(${offset}px) rotate(-1.5deg)` } : undefined}
        >
          {!readOnly ? (
            <span {...drag.gripProps(block.id)} aria-hidden="true" className="flex h-full w-8 shrink-0 cursor-grab items-center justify-center self-stretch">
              <GripIcon />
            </span>
          ) : (
            <span className="w-3" />
          )}
          <button type="button" onClick={() => onOpen(block.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2.5 pr-3 text-left">
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

  const endLine = (sectionId: string | null) =>
    drag.target && drag.target.beforeBlockId === null && (drag.target.sectionId ?? null) === sectionId ? (
      <div className="h-0.75 rounded-full bg-primary" aria-hidden="true" />
    ) : null;

  return (
    <div ref={listRef} className="flex flex-col gap-2">
      {doc.sections.length === 0 ? (
        <>
          {doc.blocks.map((block, i) => row(block, null, i))}
          {endLine(null)}
        </>
      ) : (
        doc.sections.map((section, sectionIndex) => (
          <section key={section.id} aria-label={`Phần ${sectionIndex + 1}: ${section.title}`} className="flex flex-col gap-2">
            <div className="mt-2 flex items-center gap-2">
              <SectionPill number={sectionIndex + 1} small />
              <span className="truncate text-body font-extrabold text-ink">{section.title}</span>
            </div>
            {section.blockIds.length === 0 ? (
              <div
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
            {endLine(section.id)}
          </section>
        ))
      )}
    </div>
  );
}
