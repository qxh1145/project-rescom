"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { useApiQuery } from "@/lib/api/use-api-query";
import { formActionErrorMessage } from "@/lib/forms/manage-messages";
import { createFormVersion, getInProgressAttempts, type PublisherForm } from "@/lib/forms/manage-service";

interface EditVersionDialogProps {
  open: boolean;
  form: Pick<PublisherForm, "id" | "title" | "currentVersion">;
  onClose: () => void;
  /** The survey is now a DRAFT vN+1: refresh the header before leaving. */
  onCreated: (form: PublisherForm) => void;
}

/**
 * "Chỉnh sửa" of a running Form Builder survey — ASSUMED (design) design (not drawn),
 * same panel as "Đóng & hoàn điểm". Confirms what re-versioning does (VERIFIED
 * `POST /forms/:id/versions`: back to DRAFT, off Khám phá, in-progress attempts
 * cut off, the new version needs approval), then opens the builder on vN+1.
 */
export function EditVersionDialog({ open, form, onClose, onCreated }: EditVersionDialogProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inProgress = useApiQuery(open ? `in-progress:${form.id}` : null, (signal) =>
    getInProgressAttempts(form.id, signal),
  );
  const takers = inProgress.data?.inProgressAttempts ?? 0;
  const next = form.currentVersion.versionNumber + 1;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const created = await createFormVersion(form.id);
      onCreated(created);
      router.push(`/forms/${encodeURIComponent(form.id)}/builder`);
    } catch (cause) {
      setError(formActionErrorMessage(cause, "Chưa tạo được phiên bản mới. Vui lòng thử lại."));
      setBusy(false);
    }
  }

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={close} labelledBy="edit-version-title" width={520} dismissible={!busy}>
      <div className="p-5 lg:p-7">
        <div className="flex items-start gap-3">
          <div className="mr-auto">
            <h2 id="edit-version-title" className="text-[20px] font-extrabold text-ink lg:text-title-sm">
              Chỉnh sửa khảo sát đang chạy?
            </h2>
            <p className="mt-1 text-caption text-ink-muted lg:text-body-sm">{form.title}</p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={close} disabled={busy} />
        </div>
        <ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-body-sm text-ink-strong">
          <li>
            Rescom tạo <strong className="text-ink">phiên bản v{next}</strong> từ nội dung hiện tại để bạn sửa. Câu trả lời
            đã thu vẫn giữ nguyên ở v{form.currentVersion.versionNumber}.
          </li>
          <li>Khảo sát tạm ẩn khỏi Khám phá và ngừng nhận người trả lời cho tới khi v{next} được Admin duyệt.</li>
          <li>Ký quỹ còn lại vẫn được giữ; khi gửi duyệt chỉ khoá thêm phần còn thiếu (nếu có).</li>
          {takers > 0 ? (
            <li className="text-danger-strong">{takers} người đang làm dở sẽ không nộp được bài.</li>
          ) : null}
        </ul>
        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        <div className="mt-6 flex gap-3 lg:justify-end">
          <Button variant="secondary" size="xl" onClick={close} disabled={busy}>
            Huỷ
          </Button>
          <Button
            size="lg"
            className="flex-1 lg:flex-none"
            onClick={() => void confirm()}
            loading={busy}
            loadingLabel="Đang tạo phiên bản…"
          >
            Tạo v{next} &amp; chỉnh sửa
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
