"use client";

import { Icon } from "@/components/ui/Icon";
import { ShapeIcon } from "./BuilderBits";

interface AiReviewBannerProps {
  questionCount: number;
  sectionCount: number;
  pendingCount: number;
  regenerating: boolean;
  onRegenerate: () => void;
  onUndo: (() => void) | null;
}

/** 13c status (63:876) and attention-check alert (63:891). */
export function AiReviewBanner({ questionCount, sectionCount, pendingCount, regenerating, onRegenerate, onUndo }: AiReviewBannerProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 rounded-[14px] bg-tone-blue-bg px-4 py-3" role="status">
        <Icon name="sparkles" size={20} className="text-tone-blue-fg" />
        <p className="min-w-0 flex-1 text-body-sm leading-[20.3px] text-tone-blue-fg">
          <b>
            AI đã soạn {questionCount} câu{sectionCount > 0 ? ` trong ${sectionCount} phần` : ""}.
          </b>{" "}
          Xem lại từng câu, sửa hoặc xoá tuỳ ý.
        </p>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating}
          aria-busy={regenerating || undefined}
          className="inline-flex h-10 items-center gap-2 rounded-field border border-line-strong bg-surface px-3 text-body-sm font-bold text-ink disabled:opacity-60"
        >
          <ShapeIcon name="rotate-cw" width={13.6} height={16} className={regenerating ? "animate-spin" : ""} />
          Tạo lại
        </button>
        {onUndo ? (
          <button
            type="button"
            onClick={onUndo}
            className="inline-flex h-10 items-center gap-2 rounded-field border border-line-strong bg-surface px-3 text-body-sm font-bold text-ink"
          >
            <ShapeIcon name="undo" width={13.7} height={16} />
            Hoàn tác
          </button>
        ) : null}
      </div>
      {pendingCount > 0 ? (
        <div className="flex gap-3 rounded-[14px] border border-tone-amber-strong bg-tone-amber-bg px-4 py-3" role="alert">
          <Icon name="alert-triangle" size={20} className="mt-0.5 text-tone-amber-fg" />
          <p className="text-body-sm leading-[21px] text-tone-amber-ink">
            {pendingCount > 1 ? (
              <>
                <b className="text-ink">
                  {pendingCount} câu kiểm tra chú ý cho {questionCount} câu hỏi là nhiều.
                </b>{" "}
                Form ngắn thường chỉ cần 1 câu; quá nhiều dễ khiến người trả lời thấy bị nghi ngờ. Các câu này chưa có hiệu lực cho đến khi bạn xác nhận.
              </>
            ) : (
              <>
                <b className="text-ink">AI gợi ý 1 câu kiểm tra chú ý.</b> Câu này chưa có hiệu lực cho đến khi bạn xác nhận.
              </>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
