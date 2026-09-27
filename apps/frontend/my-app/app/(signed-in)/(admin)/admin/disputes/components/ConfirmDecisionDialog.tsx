"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { CaseAction } from "@/lib/admin/disputes-view";

interface ConfirmDecisionDialogProps {
  /** The decision waiting for confirmation; null = closed. */
  action: CaseAction | null;
  note: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

/** ASSUMED (not drawn): a decision moves points and emails both parties, so it is confirmed first. */
export function ConfirmDecisionDialog({ action, note, busy, error, onCancel, onConfirm }: ConfirmDecisionDialogProps) {
  return (
    <Dialog open={action !== null} onClose={onCancel} labelledBy="confirm-decision-title" width={520}>
      {action ? (
        <div className="p-7">
          <h2 id="confirm-decision-title" className="text-title-sm font-extrabold text-ink">
            {action.confirmTitle}
          </h2>
          <p className="mt-3 text-body-sm text-ink-strong">{action.confirmBody}</p>
          <p className="mt-4 text-[14px] font-semibold text-ink">Lý do gửi cho hai bên</p>
          <blockquote className="mt-1.5 rounded-field bg-surface-muted px-3.5 py-3 text-body-sm whitespace-pre-line text-ink">
            {note}
          </blockquote>
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
              {action.confirmLabel}
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
