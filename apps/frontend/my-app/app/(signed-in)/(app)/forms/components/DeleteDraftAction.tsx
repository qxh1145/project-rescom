"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { formActionErrorMessage } from "@/lib/forms/manage-messages";
import { deleteFormDraft, type PublisherFormSummary } from "@/lib/forms/manage-service";

/**
 * "Xoá" of a never-published draft on a list row — ASSUMED design (not
 * drawn), same panel as "Rút lại". VERIFIED `DELETE /forms/:id`; a draft has
 * no Escrow, so nothing is refunded. The list reloads once it is gone.
 */
export function DeleteDraftAction({
  form,
  className,
  onDeleted,
}: {
  form: Pick<PublisherFormSummary, "id" | "title">;
  className: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    setOpen(false);
  };

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await deleteFormDraft(form.id);
      setOpen(false);
      onDeleted();
    } catch (cause) {
      setError(formActionErrorMessage(cause, "Chưa xoá được bản nháp. Vui lòng thử lại."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        Xoá
      </button>
      <Dialog open={open} onClose={close} labelledBy={`delete-draft-${form.id}`} width={480} dismissible={!busy}>
        <div className="p-5 lg:p-7">
          <div className="flex items-start gap-3">
            <div className="mr-auto">
              <h2 id={`delete-draft-${form.id}`} className="text-[20px] font-extrabold text-ink lg:text-title-sm">
                Xoá bản nháp?
              </h2>
              <p className="mt-1 text-caption text-ink-muted lg:text-body-sm">{form.title}</p>
            </div>
            <IconButton icon="x" label="Đóng" onClick={close} disabled={busy} />
          </div>
          <p className="mt-4 text-body-sm text-ink-strong">
            Bản nháp và mọi câu hỏi trong đó sẽ bị xoá vĩnh viễn,{" "}
            <strong className="text-danger-strong">không khôi phục được</strong>.
          </p>
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
              variant="danger"
              size="lg"
              className="flex-1 lg:flex-none"
              onClick={() => void confirm()}
              loading={busy}
              loadingLabel="Đang xoá…"
            >
              Xoá bản nháp
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
