"use client";

import type { FormBlockType } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { BLOCK_TYPES, SECTION_TOOL } from "@/lib/forms/builder-catalog";

interface AddQuestionSheetProps {
  open: boolean;
  onClose: () => void;
  sectionLabel: string | null;
  onAdd: (type: FormBlockType) => void;
  onAddSection: () => void;
  onAiSuggest: () => void;
  aiBusy: boolean;
  aiError: string | null;
}

/** Figma 13f "Thêm câu hỏi" bottom sheet (63:1229). */
export function AddQuestionSheet({ open, onClose, sectionLabel, onAdd, onAddSection, onAiSuggest, aiBusy, aiError }: AddQuestionSheetProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="add-question-title"
      width={390}
      className="mb-0 w-full rounded-b-none px-5 pt-3 pb-6"
    >
      <div className="mx-auto h-1.25 w-10 rounded-full bg-line" aria-hidden="true" />
      <div className="mt-3.5 flex items-start justify-between gap-3">
        <div>
          <h2 id="add-question-title" className="text-[20px] font-extrabold text-ink">
            {sectionLabel ? `Thêm vào ${sectionLabel}` : "Thêm câu hỏi"}
          </h2>
          <p className="mt-1 text-caption text-ink-muted">Câu mới nằm cuối phần, kéo để đổi vị trí sau.</p>
        </div>
        <IconButton icon="x" label="Đóng" onClick={onClose} />
      </div>

      <button
        type="button"
        onClick={onAiSuggest}
        disabled={aiBusy}
        aria-busy={aiBusy || undefined}
        className="mt-3.5 flex w-full items-center gap-3 rounded-[14px] bg-tone-blue-bg px-3.5 py-3 text-left disabled:opacity-70"
      >
        {aiBusy ? <Spinner className="size-5.5 text-tone-blue-fg" /> : <Icon name="sparkles" size={22} className="text-tone-blue-fg" />}
        <span>
          <span className="block text-body font-extrabold text-tone-blue-fg">Để AI gợi ý câu hỏi</span>
          <span className="block text-caption text-ink-strong">Dựa trên tên và các câu đã có</span>
        </span>
      </button>
      {aiError ? (
        <p role="alert" className="mt-2 text-caption text-danger">
          {aiError}
        </p>
      ) : null}

      <ul className="mt-3.5 grid grid-cols-2 gap-2">
        {BLOCK_TYPES.map((info) => (
          <li key={info.type}>
            <button
              type="button"
              onClick={() => onAdd(info.type)}
              className="flex h-19.5 w-full flex-col items-start justify-between rounded-[14px] border border-line bg-surface px-3 pt-2.5 pb-3 text-left text-body-sm font-bold text-ink active:border-primary"
            >
              <span className="flex size-8 items-center justify-center rounded-[9px] bg-surface-subtle">
                <Icon name={info.icon} size={18} />
              </span>
              {info.label}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={onAddSection}
            className="flex h-19.5 w-full flex-col items-start justify-between rounded-[14px] border border-line bg-surface px-3 pt-2.5 pb-3 text-left text-body-sm font-bold text-ink active:border-primary"
          >
            <span className="flex size-8 items-center justify-center rounded-[9px] bg-surface-subtle">
              <Icon name={SECTION_TOOL.icon} size={18} />
            </span>
            {SECTION_TOOL.label}
          </button>
        </li>
      </ul>
    </Dialog>
  );
}
