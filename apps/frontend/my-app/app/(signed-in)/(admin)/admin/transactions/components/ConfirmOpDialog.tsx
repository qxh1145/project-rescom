"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { confirmCopyOf, type LedgerOpAction } from "@/lib/admin/ledger-ops-view";

interface ConfirmOpDialogProps {
  /** The action waiting for confirmation; null = closed. */
  action: LedgerOpAction | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Story 14.4 (AC 6): every ledger operation moves or re-checks points, so it is confirmed first. */
export function ConfirmOpDialog({ action, busy, error, onCancel, onConfirm }: ConfirmOpDialogProps) {
  const copy = action ? confirmCopyOf(action) : null;
  return (
    <Dialog open={action !== null} onClose={onCancel} labelledBy="confirm-op-title" width={520} dismissible={!busy}>
      {copy ? (
        <div className="p-7">
          <h2 id="confirm-op-title" className="text-title-sm font-extrabold text-ink">
            {copy.title}
          </h2>
          <p className="mt-3 text-body-sm text-ink-strong">{copy.body}</p>
          {error ? (
            <Alert tone="danger" className="mt-4">
              {error}
            </Alert>
          ) : null}
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
              Huỷ
            </Button>
            <Button size="lg" onClick={onConfirm} loading={busy} loadingLabel="Đang xử lý…">
              {copy.confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
