"use client";

import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

interface ConfirmUserActionDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel: string;
  tone: "danger" | "primary";
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** ASSUMED (not drawn): confirmation before lock / unlock / role change. */
export function ConfirmUserActionDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  tone,
  busy,
  error,
  onConfirm,
  onClose,
}: ConfirmUserActionDialogProps) {
  return (
    <Dialog open={open} onClose={() => (busy ? undefined : onClose())} labelledBy="admin-user-confirm-title" width={480} dismissible={!busy}>
      <div className="flex flex-col gap-4 p-6">
        <h2 id="admin-user-confirm-title" className="text-title-sm font-extrabold text-ink">
          {title}
        </h2>
        <div className="flex flex-col gap-2 text-body-sm text-ink-strong">{children}</div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="md" disabled={busy} onClick={onClose}>
            Huỷ
          </Button>
          <Button variant={tone} size="md" loading={busy} loadingLabel={busyLabel} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
