"use client";

import { useState, type FormEvent } from "react";
import type { CodeIssueReason, CodeIssueReportDto } from "@rescom/schemas";
import { isApiError } from "@/lib/api/api-error";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Radio } from "@/components/ui/Radio";
import { Textarea } from "@/components/ui/Textarea";
import { CODE_ISSUE_REASONS, CODE_ISSUE_REASON_LABELS, ticketActionErrorMessage } from "@/lib/rewards/my-vouchers";
import { reportCodeIssue } from "@/lib/rewards/rewards-service";

const NOTE_MAX = 500;

interface CodeIssueSheetProps {
  ticketId: string;
  open: boolean;
  onClose: () => void;
  onReported: (report: CodeIssueReportDto) => void;
  /** A 409 means the server's state differs from what the page shows. */
  onReload: () => void;
}

export function CodeIssueSheet({ ticketId, open, onClose, onReported, onReload }: CodeIssueSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  // The form is mounted by Dialog only while open, so every opening starts empty.
  return (
    <Dialog open={open} onClose={onClose} dismissible={!submitting} width={480} labelledBy="code-issue-title" className="max-lg:mb-0 max-lg:w-full max-lg:rounded-b-none">
      <CodeIssueForm ticketId={ticketId} submitting={submitting} setSubmitting={setSubmitting} onClose={onClose} onReported={onReported} onReload={onReload} />
    </Dialog>
  );
}

function CodeIssueForm({ ticketId, submitting, setSubmitting, onClose, onReported, onReload }: Omit<CodeIssueSheetProps, "open"> & { submitting: boolean; setSubmitting: (value: boolean) => void }) {
  const [reason, setReason] = useState<CodeIssueReason | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const trimmed = note.trim();
  const valid = reason !== null && (reason !== "OTHER" || trimmed.length > 0);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || !reason || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      onReported(await reportCodeIssue(ticketId, { reason, ...(trimmed ? { note: trimmed } : {}) }));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(ticketActionErrorMessage(cause));
      if (isApiError(cause) && cause.status === 409) onReload();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="px-6 pb-7 pt-5 max-lg:pt-3">
      <div className="mx-auto mb-4 h-1.25 w-10 rounded-full bg-line lg:hidden" aria-hidden />
      <h2 id="code-issue-title" className="text-title-sm font-bold">Báo mã lỗi</h2>
      <p className="mt-1 text-body-sm text-ink-muted">Admin xử lý trong 1 ngày làm việc: đổi mã mới hoặc trả lại điểm.</p>
      <fieldset className="mt-5 space-y-3" disabled={submitting}>
        <legend className="sr-only">Lý do báo lỗi</legend>
        {CODE_ISSUE_REASONS.map((value) => (
          <Radio key={value} id={`code-issue-${value}`} name="code-issue-reason" label={CODE_ISSUE_REASON_LABELS[value]} checked={reason === value} onChange={() => setReason(value)} />
        ))}
      </fieldset>
      <Textarea id="code-issue-note" className="mt-5" label={reason === "OTHER" ? "Mô tả thêm" : "Mô tả thêm (không bắt buộc)"} value={note} maxLength={NOTE_MAX} onChange={(event) => setNote(event.target.value)} disabled={submitting} required={reason === "OTHER"} />
      {error && <p role="alert" className="mt-3 text-body-sm text-danger">{error}</p>}
      <div className="mt-6 flex flex-col items-center gap-2 lg:items-end">
        <Button type="submit" size="base" className="w-full lg:w-auto" loading={submitting} loadingLabel="Đang gửi…" disabled={!valid}>Gửi báo lỗi</Button>
        <button type="button" className="p-2 font-semibold text-primary disabled:opacity-50" onClick={onClose} disabled={submitting}>Huỷ</button>
      </div>
    </form>
  );
}
