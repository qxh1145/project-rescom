"use client";

import { PILOT_BUILD } from "@/lib/pilot-scope";
import { useRef, useState, type RefObject } from "react";
import Link from "next/link";
import type { FormBlock } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import {
  addSection,
  canMoveBy,
  dropBlockAt,
  duplicateBlockById,
  insertBlock,
  moveBlockBy,
  removeBlock,
  removeSection,
  renameSection,
  summarizeDoc,
  toDraftDefinition,
  updateBlock,
  type BuilderSection,
} from "@/lib/forms/builder-blocks";
import { internalPriceHint } from "@/lib/forms/builder-publish";
import type { BuilderEditor } from "../hooks/use-builder-editor";
import { useFlipLayout } from "../hooks/use-flip-layout";
import { useReorderDrag, type DropTarget } from "../hooks/use-reorder-drag";
import { BlockCard } from "./BlockCard";
import { SectionPill } from "./BuilderBits";

interface CanvasProps {
  editor: BuilderEditor;
  formId: string;
  /** The question list; the toolbox drag (hooks/use-palette-drag.ts) reads drop targets from it. */
  listRef: RefObject<HTMLDivElement | null>;
  /** A toolbox type is being dragged, and the gap it would land in. */
  paletteDragging: boolean;
  paletteTarget: DropTarget | null;
}

/**
 * One indicator for the whole list, drawn over the gap (it takes no space, so
 * the cards never jump) and gliding from gap to gap as the pointer moves.
 */
function DropIndicator({ target }: { target: DropTarget }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-0 right-0 left-0 z-10 h-6 transition-[translate] duration-150 ease-out"
      style={{ translate: `0 ${target.y - 12}px` }}
    >
      <div className="drop-indicator-in relative h-full">
        <span className="absolute top-1/2 right-0 left-0 h-0.75 -translate-y-1/2 rounded-full bg-primary" />
        <span className="absolute top-1/2 -left-1.25 size-2.5 -translate-y-1/2 rounded-full bg-primary" />
        <span className="absolute top-0 left-1/2 inline-flex h-6 -translate-x-1/2 items-center rounded-full bg-primary px-2.5 text-[12px] font-bold whitespace-nowrap text-surface shadow-[0_4px_10px_rgba(30,36,70,0.18)]">
          Thả vào đây · câu {target.number}
        </span>
      </div>
    </div>
  );
}

/** Figma 13 canvas (63:4406 empty, 72:252 with questions). */
export function Canvas({ editor, formId, listRef, paletteDragging, paletteTarget }: CanvasProps) {
  const { doc, readOnly } = editor;
  const rootRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const summary = summarizeDoc(doc);
  const numberOf = new Map(doc.blocks.map((block, i) => [block.id, i + 1]));

  const reorder = useReorderDrag(listRef, (blockId, target) => {
    editor.change(
      (current) => dropBlockAt(current, blockId, target.sectionId, target.index),
      `Đã chuyển câu hỏi tới vị trí câu ${Math.min(target.number, doc.blocks.length)}.`,
    );
  });
  const target = reorder.target ?? paletteTarget;
  useFlipLayout(rootRef);

  const selectedSectionId =
    (editor.selectedId && doc.sections.find((s) => s.blockIds.includes(editor.selectedId as string))?.id) || null;

  const addQuestion = (sectionId: string | null) => {
    let created = "";
    editor.change((current) => {
      const result = insertBlock(current, "single_choice", { sectionId });
      created = result.blockId;
      return result.doc;
    }, "Đã thêm câu hỏi Một lựa chọn.");
    if (created) editor.select(created);
  };

  const renderCard = (block: FormBlock, section: BuilderSection | null, indexInSection: number) => {
    const number = numberOf.get(block.id) ?? 0;
    const pendingAttention = editor.pending.some((item) => item.blockId === block.id);
    return (
      <div key={block.id} data-flip={block.id}>
        <BlockCard
          block={block}
          number={number}
          sectionId={section?.id ?? null}
          indexInSection={indexInSection}
          selected={editor.selectedId === block.id}
          pendingAttention={pendingAttention}
          isAi={editor.aiBlockIds.has(block.id)}
          issues={editor.issues.blocks[block.id] ?? []}
          readOnly={readOnly}
          dragPhase={reorder.dragging?.blockId === block.id ? reorder.dragging.phase : null}
          dragProps={reorder.dragProps(block.id)}
          canMoveUp={canMoveBy(doc, block.id, -1)}
          canMoveDown={canMoveBy(doc, block.id, 1)}
          onSelect={() => editor.select(block.id)}
          onRequiredChange={(required) =>
            editor.change((current) => updateBlock(current, block.id, { ...block, required } as FormBlock),
              required ? `Câu ${number} là câu bắt buộc.` : `Câu ${number} không bắt buộc.`)
          }
          onDuplicate={() => {
            let created = "";
            editor.change((current) => {
              const result = duplicateBlockById(current, block.id);
              created = result.blockId;
              return result.doc;
            }, `Đã nhân bản câu ${number}.`);
            if (created) editor.select(created);
          }}
          onDelete={() => {
            editor.change((current) => removeBlock(current, block.id), `Đã xoá câu ${number}.`);
            editor.select(null);
          }}
          onMove={(delta) =>
            editor.change(
              (current) => moveBlockBy(current, block.id, delta),
              `Đã chuyển câu ${number} ${delta < 0 ? "lên" : "xuống"}, giờ là câu ${number + delta}.`,
            )
          }
        />
      </div>
    );
  };

  const hint = internalPriceHint(summary.minutes, toDraftDefinition(doc));

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-4 pt-6 pb-16 lg:px-0">
      {/* Title card (63:4407): 6px primary top border. */}
      <div className="rounded-[16px] border border-t-6 border-primary bg-surface px-5.5 pt-4 pb-5">
        <label className="sr-only" htmlFor="builder-title">
          Tên khảo sát
        </label>
        <input
          id="builder-title"
          value={doc.title}
          readOnly={readOnly}
          maxLength={200}
          onChange={(event) => editor.change((current) => ({ ...current, title: event.target.value }))}
          placeholder="Khảo sát chưa có tên"
          className="w-full rounded-[6px] bg-transparent text-title-sm font-extrabold text-ink placeholder:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
        <label className="sr-only" htmlFor="builder-description">
          Mô tả khảo sát
        </label>
        <input
          id="builder-description"
          value={doc.description}
          readOnly={readOnly}
          maxLength={2000}
          onChange={(event) => editor.change((current) => ({ ...current, description: event.target.value }))}
          placeholder="Thêm mô tả ngắn: mục đích, thời lượng, cam kết ẩn danh"
          className="mt-1.5 w-full rounded-[6px] bg-transparent text-body-sm text-ink-muted placeholder:text-ink-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        />
      </div>
      {editor.issues.form.length > 0 ? (
        <p className="text-caption text-danger">{editor.issues.form.join(" ")}</p>
      ) : null}

      <div ref={listRef} data-tour="builder-canvas" className="relative flex flex-col gap-3">
        {target ? <DropIndicator target={target} /> : null}
        {doc.blocks.length === 0 && doc.sections.length === 0 ? (
          <div
            data-drop-empty=""
            data-section=""
            data-index={0}
            data-number={1}
            className={`flex flex-col items-center rounded-[20px] border-2 border-dashed bg-surface px-6 pt-10 pb-10 text-center transition-colors ${
              paletteDragging ? "border-primary bg-tone-green-tint" : "border-line-strong"
            }`}
          >
            <span className="flex size-14 items-center justify-center rounded-[16px] bg-tone-green-bg text-primary">
              <Icon name="plus" size={28} />
            </span>
            <p className="mt-3 text-[20px] font-extrabold text-ink">Kéo khối câu hỏi đầu tiên vào đây</p>
            <p className="mt-2 max-w-[420px] text-body-sm text-ink-muted">
              Hoặc nhấn vào một khối ở cột trái. Bạn đổi thứ tự, chia phần và sửa từng câu bất cứ lúc nào, form tự lưu.
            </p>
          </div>
        ) : doc.sections.length === 0 ? (
          doc.blocks.map((block, i) => renderCard(block, null, i))
        ) : (
          doc.sections.map((section, sectionIndex) => {
            const isCollapsed = collapsed.has(section.id);
            const sectionBlocks = section.blockIds.map((id) => doc.blocks.find((b) => b.id === id) as FormBlock);
            const firstNumber = doc.sections.slice(0, sectionIndex).reduce((n, s) => n + s.blockIds.length, 0) + 1;
            return (
              <section key={section.id} aria-labelledby={`section-${section.id}`} className="flex flex-col gap-3">
                <div data-flip={`section:${section.id}`} className="mt-2 flex items-center gap-2.5 pl-1">
                  <SectionPill number={sectionIndex + 1} />
                  <label className="sr-only" htmlFor={`section-${section.id}`}>
                    Tên phần {sectionIndex + 1}
                  </label>
                  <input
                    id={`section-${section.id}`}
                    value={section.title}
                    readOnly={readOnly}
                    maxLength={200}
                    onChange={(event) => editor.change((current) => renameSection(current, section.id, event.target.value))}
                    className="min-w-0 flex-1 rounded-[6px] bg-transparent text-lead font-extrabold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  />
                  <span className="shrink-0 text-caption text-ink-muted">{section.blockIds.length} câu</span>
                  {!readOnly && doc.sections.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => editor.change((current) => removeSection(current, section.id), `Đã bỏ phần ${sectionIndex + 1}; câu hỏi được gộp vào phần bên cạnh.`)}
                      className="shrink-0 rounded-full px-2 py-1 text-caption font-bold text-ink-muted hover:bg-surface-subtle"
                    >
                      Bỏ phần
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? `Mở phần ${sectionIndex + 1}` : `Thu gọn phần ${sectionIndex + 1}`}
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(section.id)) next.delete(section.id);
                        else next.add(section.id);
                        return next;
                      })
                    }
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle"
                  >
                    <Icon name="chevron-down" size={18} className={isCollapsed ? "-rotate-90" : ""} />
                  </button>
                </div>
                {isCollapsed ? null : sectionBlocks.length === 0 ? (
                  <div
                    data-flip={`empty:${section.id}`}
                    data-drop-empty=""
                    data-section={section.id}
                    data-index={0}
                    data-number={firstNumber}
                    className="rounded-[16px] border border-dashed border-line-strong bg-surface px-4 py-5 text-center text-caption text-ink-muted"
                  >
                    Phần này chưa có câu hỏi. Kéo một khối vào đây hoặc bấm “Thêm câu hỏi”.
                  </div>
                ) : (
                  sectionBlocks.map((block, i) => renderCard(block, section, i))
                )}
              </section>
            );
          })
        )}
      </div>

      {!PILOT_BUILD && doc.blocks.length === 0 && doc.sections.length === 0 ? (
        <>
          <div className="flex items-center gap-3 text-caption text-ink-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            hoặc
            <span className="h-px flex-1 bg-line" />
          </div>
          <Link
            href={`/forms/${formId}/builder/ai`}
            className="flex items-center gap-4 rounded-[20px] border border-line-strong bg-surface px-5.5 py-5 hover:border-primary"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-tone-blue-bg text-tone-blue-fg">
              <Icon name="sparkles" size={24} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-lead font-extrabold text-ink">Mô tả khảo sát, AI soạn bản nháp</span>
              <span className="text-caption leading-[18.9px] text-ink-muted">
                AI gợi ý các phần và câu hỏi, bạn xem lại và sửa trước khi dùng. Không bắt buộc.
              </span>
            </span>
            <Icon name="chevron-right" size={20} className="text-ink-muted" />
          </Link>
        </>
      ) : !readOnly ? (
        <>
          <div data-flip="actions" className="flex gap-2.5">
            <button
              type="button"
              onClick={() => addQuestion(selectedSectionId ?? doc.sections.at(-1)?.id ?? null)}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-surface text-body-sm font-bold text-ink hover:border-primary"
            >
              <Icon name="plus" size={18} />
              Thêm câu hỏi
            </button>
            <button
              type="button"
              onClick={() =>
                editor.change((current) => addSection(current).doc, "Đã thêm phần mới ở cuối form.")
              }
              className="flex h-11 items-center justify-center gap-2 rounded-field border border-dashed border-line-strong bg-surface px-4 text-body-sm font-bold text-ink hover:border-primary"
            >
              <Icon name="section-split" size={18} />
              Thêm phần
            </button>
          </div>
          <div data-flip="summary" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border border-line bg-surface px-4 py-3 text-caption">
            <span className="font-bold text-ink">
              {summary.questionCount} câu{summary.sectionCount > 0 ? ` · ${summary.sectionCount} phần` : ""} · khoảng {summary.minutes} phút
            </span>
            {summary.attentionNumbers.length > 0 ? (
              <span className="text-ink-strong">· {summary.attentionNumbers.length} câu kiểm tra chú ý</span>
            ) : null}
            <span className="ml-auto inline-flex h-7 items-center rounded-full bg-tone-green-bg px-2.5 font-bold text-tone-green-fg">
              Giá gợi ý {hint.label} · {hint.paidLabel}
            </span>
          </div>
        </>
      ) : null}
    </div>
  );
}

