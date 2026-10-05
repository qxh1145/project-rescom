"use client";

import type { FileAttachmentAnswer, FileUploadBlock } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import {
  allowedTypesLabel,
  formatFileSize,
  isFileAttachmentList,
  maxFileBytes,
} from "@/lib/participation/file-upload";
import type { UploadStage } from "@/lib/participation/file-upload-service";
import type { FileUploadControls } from "../../hooks/use-file-uploads";

/**
 * `file_upload` answer of the in-Rescom runner (mock-off Phase 7, not drawn
 * in Figma 4 — ASSUMED: page 8 field styles). Presentational: the uploads
 * themselves live in the runner (`useFileUploads`), so leaving the page or
 * paging away never loses or orphans one. Only CLEAN files are the answer.
 */

const STAGE_LABEL: Record<UploadStage, string> = {
  initiating: "Đang chuẩn bị…",
  uploading: "Đang tải lên…",
  scanning: "Đang quét an toàn…",
};

interface FileUploadAnswerProps {
  block: FileUploadBlock;
  value: unknown;
  controls: FileUploadControls;
  inputId: string;
  labelledBy: string;
  describedBy?: string;
  invalid: boolean;
}

export function FileUploadAnswer({ block, value, controls, inputId, labelledBy, describedBy, invalid }: FileUploadAnswerProps) {
  const files: FileAttachmentAnswer[] = isFileAttachmentList(value) ? value : [];
  const { items, notice, liveCount, deleting } = controls;
  const removing = new Set(items.filter((item) => item.key.startsWith("remove-")).map((item) => item.objectId));
  const pending = items.filter((item) => !item.key.startsWith("remove-"));
  // A delete still settling counts as a live file: wait for it before choosing again.
  const canAdd = liveCount < block.maxFiles && !deleting;
  const allowed = block.allowedMimeTypes ?? [];
  const hintId = `${inputId}-hint`;

  return (
    <div className="flex flex-col gap-3">
      {files.length > 0 || pending.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Tệp đã chọn">
          {files.map((file) => (
            <li key={file.objectId} className="flex items-center gap-3 rounded-field border border-line bg-surface px-3.5 py-3">
              <Icon name="check-circle" size={20} className="text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body-sm font-bold text-ink">{file.fileName}</p>
                <p className="text-caption text-ink-muted">
                  {formatFileSize(file.fileSize)} · {removing.has(file.objectId) ? "Đang xoá…" : "Đã kiểm tra an toàn"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => controls.remove(file)}
                disabled={removing.has(file.objectId)}
                className="rounded-field p-1.5 text-ink-muted hover:bg-surface-subtle hover:text-danger disabled:opacity-50"
                aria-label={`Xoá tệp ${file.fileName}`}
              >
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
          {pending.map((item) =>
            item.state === "failed" ? (
              <li key={item.key} className="flex flex-col gap-2 rounded-field border border-danger bg-danger-soft px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <Icon name="alert-circle" size={18} className="text-danger" />
                  <p className="min-w-0 flex-1 truncate text-body-sm font-bold text-ink">{item.name}</p>
                </div>
                <p className="text-caption text-danger" role="alert">
                  {item.message}
                </p>
                <div className="flex gap-4">
                  {item.retryExhausted || (!item.file && !item.retryFinalize) ? null : (
                    <button type="button" onClick={() => controls.retry(item.key)} className="text-label font-bold text-primary">
                      Thử lại
                    </button>
                  )}
                  <button type="button" onClick={() => controls.dismiss(item.key)} className="text-label font-bold text-ink-muted">
                    Bỏ tệp này
                  </button>
                </div>
              </li>
            ) : (
              <li key={item.key} className="flex flex-col gap-2 rounded-field border border-line bg-surface-muted px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <Icon name="loader" size={18} className="animate-spin text-ink-muted" />
                  <p className="min-w-0 flex-1 truncate text-body-sm font-bold text-ink">{item.name}</p>
                  <span className="text-caption text-ink-muted" aria-live="polite">
                    {item.state === "deleting" ? "Đang xoá…" : STAGE_LABEL[item.stage ?? "initiating"]}
                  </span>
                </div>
                {item.state === "working" ? (
                  <ProgressBar value={item.percent ?? 0} height={6} label={`Tiến độ tải ${item.name}`} />
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : null}

      {liveCount < block.maxFiles ? (
        <label
          htmlFor={inputId}
          aria-disabled={!canAdd || undefined}
          className={`flex flex-col items-center gap-1.5 rounded-field border border-dashed px-4 py-5 text-center ${
            canAdd ? "cursor-pointer hover:bg-surface-subtle" : "cursor-not-allowed opacity-60"
          } ${invalid ? "border-danger" : "border-line-strong"}`}
        >
          <Icon name="upload" size={22} className="text-primary" />
          <span className="text-body-sm font-bold text-primary">{canAdd ? "Chọn tệp để tải lên" : "Đang xoá tệp…"}</span>
          <span id={hintId} className="text-caption text-ink-muted">
            Tối đa {block.maxFiles} tệp · mỗi tệp ≤ {formatFileSize(maxFileBytes(block))}
            {allowed.length > 0 ? ` · ${allowedTypesLabel(allowed)}` : ""}
          </span>
          <input
            id={inputId}
            type="file"
            className="sr-only"
            disabled={!canAdd}
            multiple={block.maxFiles - liveCount > 1}
            accept={allowed.join(",") || undefined}
            aria-labelledby={labelledBy}
            aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
            aria-invalid={invalid || undefined}
            aria-required={block.required || undefined}
            onChange={(event) => {
              controls.choose(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </label>
      ) : null}

      {notice ? (
        <p className="text-caption text-danger" role="alert">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Builder preview (no attempt): the chosen file is only described
 * (`{ name, size, type }`, the preview value `validateBlockAnswer` accepts),
 * never uploaded.
 */
export function PreviewFileAnswer({
  block,
  value,
  onChange,
  inputId,
  labelledBy,
  describedBy,
}: {
  block: FileUploadBlock;
  value: unknown;
  onChange: (value: { name: string; size: number; type: string }[]) => void;
  inputId: string;
  labelledBy: string;
  describedBy?: string;
}) {
  const chosen = Array.isArray(value) ? (value as { name?: unknown }[]) : [];
  const hintId = `${inputId}-hint`;
  const allowed = block.allowedMimeTypes ?? [];
  return (
    <label
      htmlFor={inputId}
      className="flex cursor-pointer flex-col items-center gap-1.5 rounded-field border border-dashed border-line-strong px-4 py-5 text-center hover:bg-surface-subtle"
    >
      <Icon name="upload" size={22} className="text-primary" />
      <span className="text-body-sm font-bold text-primary">
        {chosen.length > 0 ? chosen.map((file) => String(file.name ?? "")).join(", ") : "Chọn tệp (xem trước, không tải lên)"}
      </span>
      <span id={hintId} className="text-caption text-ink-muted">
        Tối đa {block.maxFiles} tệp · mỗi tệp ≤ {formatFileSize(maxFileBytes(block))}
        {allowed.length > 0 ? ` · ${allowedTypesLabel(allowed)}` : ""}
      </span>
      <input
        id={inputId}
        type="file"
        className="sr-only"
        multiple={block.maxFiles > 1}
        accept={allowed.join(",") || undefined}
        aria-labelledby={labelledBy}
        aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
        onChange={(event) => {
          const list = Array.from(event.target.files ?? []).map((file) => ({ name: file.name, size: file.size, type: file.type }));
          onChange(list);
          event.target.value = "";
        }}
      />
    </label>
  );
}
