"use client";

import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AiDraft } from "@/lib/forms/builder-ai";
import { estimateMinutes } from "@/lib/forms/builder-blocks";
import { internalPriceHint } from "@/lib/forms/builder-publish";
import { AttentionChip, SectionPill, TypeChip } from "../../components/BuilderBits";

/** Gap between two questions appearing in a fresh draft. */
const STAGGER_STEP_MS = 80;

/**
 * 13b' "Bản nháp khảo sát" aside (62:2430): the assistant's current draft,
 * suggested attention checks shown as "chờ xác nhận"; "Mở trong Form
 * Builder" applies it for review (13c). With `stagger` (a draft that just
 * came back) the questions appear one after another.
 */
export function AiDraftPanel({
  formId,
  draft,
  stagger = false,
  onClose,
}: {
  formId: string;
  draft: AiDraft;
  stagger?: boolean;
  onClose: () => void;
}) {
  const minutes = estimateMinutes(draft.blocks);
  const pending = new Set(draft.attentionSuggestions.map((s) => s.blockId));
  const numberOf = new Map(draft.blocks.map((block, i) => [block.id, i + 1]));
  const groups = draft.sections.length > 0 ? draft.sections : [{ id: "all", title: "", blockIds: draft.blocks.map((b) => b.id) }];
  const hint = internalPriceHint(minutes);

  return (
    <section aria-labelledby="ai-draft-title" className="flex h-full flex-col bg-surface">
      <div className="flex items-center gap-2.5 border-b border-line px-4.5 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-tone-green-bg text-primary">
          <Icon name="file-text" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ai-draft-title" className="text-body font-extrabold text-ink">
            Bản nháp khảo sát
          </h2>
          <p className="text-[12px] text-ink-muted">
            Do trợ lý soạn · {draft.blocks.length} câu · ~{minutes} phút
          </p>
        </div>
        <Link href={`/forms/${formId}/builder?review=ai`} className={buttonClassName({ size: "md", radius: "field", className: "text-label" })}>
          Mở trong Form Builder
        </Link>
        <button type="button" onClick={onClose} aria-label="Đóng bản nháp" className="flex size-9 items-center justify-center rounded-full text-ink-muted hover:bg-surface-subtle">
          <Icon name="x" size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4.5 py-4">
        <div className="rounded-[14px] border border-line px-4 py-3.5">
          <p className="text-lead font-extrabold text-ink">{draft.title}</p>
          {draft.description ? <p className="mt-1 text-caption text-ink-muted">{draft.description}</p> : null}
        </div>
        {groups.map((group, groupIndex) => (
          <div key={group.id} className="mt-4">
            {group.title ? (
              <div className="mb-2 flex items-center gap-2">
                <SectionPill number={groupIndex + 1} small />
                <span className="text-body font-extrabold text-ink">{group.title}</span>
                <span className="text-caption text-ink-muted">{group.blockIds.length} câu</span>
              </div>
            ) : null}
            <ol className="flex flex-col gap-2">
              {group.blockIds.map((id) => {
                const block = draft.blocks.find((b) => b.id === id);
                if (!block) return null;
                const isPending = pending.has(id);
                const order = (numberOf.get(id) ?? 1) - 1;
                return (
                  <li
                    key={id}
                    style={stagger ? { animationDelay: `${Math.min(order, 24) * STAGGER_STEP_MS}ms` } : undefined}
                    className={`rounded-[14px] px-3.5 py-3 ${stagger ? "ai-block-in " : ""}${
                      isPending ? "border border-dashed border-tone-amber-strong bg-tone-amber-tint" : "border border-line bg-surface"
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-extrabold text-ink-muted">{numberOf.get(id)}</span>
                      <TypeChip type={block.type} compact />
                      {isPending ? <AttentionChip pending /> : null}
                    </span>
                    <span className="mt-1.5 block text-body leading-[21px] font-bold text-ink">
                      {block.title}
                      {block.required ? <span className="text-danger"> *</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
        <p className="mt-4 text-caption leading-[18px] text-ink-muted">
          Giá gợi ý {hint.label} cho người làm; {hint.paidLabel} (rẻ hơn 20% so với Google Forms). Bạn đặt đối tượng và số mẫu ở bước sau.
        </p>
      </div>
    </section>
  );
}
