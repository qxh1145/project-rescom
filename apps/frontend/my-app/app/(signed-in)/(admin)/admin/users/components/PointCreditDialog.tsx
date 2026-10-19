"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import type { AdminUserView } from "@/lib/admin/users-service";
import {
  needsRetypeConfirm,
  retypeMatches,
  shortCodeOf,
} from "@/lib/admin/users-view";
import { randomUuid } from "@/lib/random-uuid";
import { formatPoints } from "@/lib/wallet/top-up";

interface PointCreditDialogProps {
  open: boolean;
  user: AdminUserView;
  amount: number;
  reason: string;
  busy: boolean;
  error: string | null;
  onConfirm: (idempotencyKey: string) => void;
  onClose: () => void;
}

const TITLE_ID = "admin-point-credit-confirm-title";

export function PointCreditDialog({
  open,
  user,
  amount,
  reason,
  busy,
  error,
  onConfirm,
  onClose,
}: PointCreditDialogProps) {
  const [retype, setRetype] = useState("");
  const [retypeTouched, setRetypeTouched] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const needsRetype = needsRetypeConfirm(amount);
  const matched = retypeMatches(retype, amount);
  const canConfirm = !busy && (!needsRetype || matched);

  const close = () => {
    if (busy) return;
    idempotencyKey.current = null;
    setRetype("");
    setRetypeTouched(false);
    onClose();
  };

  const confirm = () => {
    if (!canConfirm) return;
    idempotencyKey.current ??= randomUuid();
    onConfirm(idempotencyKey.current);
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      labelledBy={TITLE_ID}
      width={480}
      dismissible={!busy}
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={TITLE_ID} className="text-title-sm font-extrabold text-ink">
          Cộng {formatPoints(amount)} Điểm cho {shortCodeOf(user.id)}?
        </h2>
        <div className="flex flex-col gap-2 text-body-sm text-ink-strong">
          <p>
            Điểm được cộng ngay vào số dư Khả dụng và người dùng sẽ nhận thông báo
            kèm lý do. Muốn hoàn tác, dùng &quot;Hoàn tác&quot; trong danh sách
            bên dưới.
          </p>
          <p>
            Lý do: <span className="font-semibold text-ink">{reason.trim()}</span>
          </p>
        </div>

        {needsRetype ? (
          <TextField
            id="admin-point-credit-retype"
            label="Nhập lại số Điểm để xác nhận"
            inputMode="numeric"
            value={retype}
            disabled={busy}
            error={
              retypeTouched && !matched
                ? "Số Điểm nhập lại không khớp."
                : undefined
            }
            onChange={(event) => {
              setRetype(event.target.value);
              setRetypeTouched(true);
            }}
          />
        ) : null}

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="md" disabled={busy} onClick={close}>
            Huỷ
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!canConfirm}
            loading={busy}
            loadingLabel="Đang cộng…"
            onClick={confirm}
          >
            Cộng Điểm
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
