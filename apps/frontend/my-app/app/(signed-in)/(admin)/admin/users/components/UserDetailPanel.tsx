"use client";

import Link from "next/link";
import { useState } from "react";
import type { UserRole } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import type { AdminUserView } from "@/lib/admin/users-service";
import {
  LOCK_REASON_MAX,
  ROLE_LABELS,
  accountLineOf,
  formatCount,
  lockReasonError,
  profileLineOf,
  selfActionBlock,
  shortCodeOf,
  userStatusView,
  userTitleOf,
} from "@/lib/admin/users-view";
import { useSession } from "@/lib/session/SessionProvider";
import { useUserActions } from "../hooks/use-user-actions";
import { ConfirmUserActionDialog } from "./ConfirmUserActionDialog";
import { StatusPill } from "./StatusPill";

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((role) => ({ value: role, label: ROLE_LABELS[role] }));

type Dialog = "lock" | "unlock" | "role" | null;

interface UserDetailPanelProps {
  user: AdminUserView;
  /** Refreshing the profile failed (the list row is still shown). */
  detailError: string | null;
  onRetryDetail: () => void;
  onUpdated: (user: AdminUserView) => void;
}

/**
 * Figma 11d "Section – Hồ sơ người dùng" (63:2345): 430px card — summary cards,
 * profile, FraudLog link, lock reason + "Khoá tài khoản". Unlock and the role
 * change are ASSUMED (not drawn) but use the same VERIFIED routes.
 */
export function UserDetailPanel({ user, detailError, onRetryDetail, onUpdated }: UserDetailPanelProps) {
  const { user: actor } = useSession();
  const actions = useUserActions(onUpdated);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>(user.role);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const code = shortCodeOf(user.id);
  const title = userTitleOf(user);
  const status = userStatusView(user);
  const profileLine = profileLineOf(user.profile);
  const fraudCount = user.fraudLog?.count14d;
  const lockBlock = selfActionBlock(user.id, actor?.id, "lock");
  const roleBlock = selfActionBlock(user.id, actor?.id, "role");
  const locked = user.status === "LOCKED";

  function openDialog(next: Exclude<Dialog, null>) {
    actions.clearError();
    setNotice(null);
    setDialog(next);
  }

  function requestLock() {
    const error = lockReasonError(reason);
    setReasonError(error);
    if (!error) openDialog("lock");
  }

  async function confirm() {
    if (dialog === "lock") {
      if (await actions.lock(user.id, reason)) {
        setReason("");
        setNotice(`Đã khoá tài khoản ${code}.`);
        setDialog(null);
      }
    } else if (dialog === "unlock") {
      if (await actions.unlock(user.id)) {
        setNotice(`Đã mở khoá tài khoản ${code}.`);
        setDialog(null);
      }
    } else if (dialog === "role") {
      if (await actions.changeRole(user.id, role)) {
        setNotice(`Đã đổi vai trò thành ${ROLE_LABELS[role]}.`);
        setDialog(null);
      }
    }
  }

  return (
    <section
      id="admin-user-detail"
      aria-labelledby="admin-user-detail-title"
      className="min-w-0 rounded-[22px] border border-line bg-surface p-6"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="admin-user-detail-title" className="truncate text-[18px] font-extrabold text-ink">
            {title}
          </h2>
          <p className="mt-1.5 truncate text-caption text-ink-muted">{accountLineOf(user)}</p>
        </div>
        {/* ASSUMED: status pill in the panel (the drawn user is active). */}
        {status.tone !== "teal" ? <StatusPill tone={status.tone}>{status.label}</StatusPill> : null}
      </div>

      {detailError ? (
        <Alert tone="danger" className="mt-3 items-center">
          <span className="flex flex-wrap items-center gap-3">
            {detailError}
            <Button variant="secondary" size="sm" onClick={onRetryDetail}>
              Thử lại
            </Button>
          </span>
        </Alert>
      ) : null}

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <StatCard label="Khả dụng" value={formatCount(user.balance?.available)} />
        <StatCard label="Chờ 48h" value={formatCount(user.balance?.pending)} tone="amber" />
        <StatCard label="Lượt làm" value={formatCount(user.attemptCount)} />
      </dl>

      <h3 className="mt-4 text-label font-bold text-ink">Hồ sơ</h3>
      <p className="mt-1.5 text-body-sm text-ink-strong">{profileLine ?? "Chưa hoàn tất hồ sơ nhân khẩu học."}</p>

      {fraudCount ? (
        <Link
          href={`/admin/fraud-log?userId=${encodeURIComponent(user.id)}`}
          className="mt-3.5 inline-block text-label font-bold text-primary hover:underline"
        >
          Xem {fraudCount} mục FraudLog →
        </Link>
      ) : (
        <p className="mt-3.5 text-label text-ink-muted">Không có mục FraudLog nào trong 14 ngày.</p>
      )}

      {notice ? (
        <Alert tone="info" className="mt-4" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      ) : null}

      {locked ? (
        <div className="mt-4 flex flex-col gap-4">
          {/* ASSUMED (not drawn): the locked state and "Mở khoá". */}
          <div className="rounded-field bg-danger-soft px-3.5 py-3">
            <p className="text-label font-bold text-danger-strong">Tài khoản đang bị khoá</p>
            {user.lockReason ? <p className="mt-1 text-body-sm text-ink">Lý do: {user.lockReason}</p> : null}
          </div>
          <Button variant="outline" size="lg" fullWidth disabled={actions.busy !== null} onClick={() => openDialog("unlock")}>
            Mở khoá tài khoản
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <Textarea
            id="admin-lock-reason"
            label="Lý do khoá · ghi vào nhật ký, gửi email"
            rows={3}
            maxLength={LOCK_REASON_MAX}
            value={reason}
            disabled={Boolean(lockBlock)}
            placeholder="Vi phạm lặp lại: nộp quá nhanh, sai mã, khiếu nại được chấp nhận 26/09."
            error={reasonError ?? undefined}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError) setReasonError(null);
            }}
          />
          <Button variant="danger" size="lg" fullWidth disabled={Boolean(lockBlock) || actions.busy !== null} onClick={requestLock}>
            Khoá tài khoản
          </Button>
        </div>
      )}
      <p className="mt-4 text-[12px] leading-4.5 text-ink-muted">
        {lockBlock ?? "Tài khoản bị khoá không đăng nhập được. Mở khoá sẽ trả lại toàn bộ quyền."}
      </p>

      {/* ASSUMED (not drawn): role change, VERIFIED PATCH /admin/users/:id/role. */}
      <div className="mt-5 border-t border-line-subtle pt-4">
        <div className="flex items-end gap-3">
          <Select
            id="admin-user-role"
            label="Vai trò"
            height={44}
            className="flex-1"
            options={ROLE_OPTIONS}
            value={role}
            disabled={Boolean(roleBlock)}
            onChange={(event) => setRole(event.target.value as UserRole)}
          />
          <Button
            variant="secondary"
            size="md"
            disabled={Boolean(roleBlock) || role === user.role || actions.busy !== null}
            onClick={() => openDialog("role")}
          >
            Đổi vai trò
          </Button>
        </div>
        {roleBlock ? <p className="mt-2 text-[12px] leading-4.5 text-ink-muted">{roleBlock}</p> : null}
      </div>

      <ConfirmUserActionDialog
        open={dialog === "lock"}
        title={`Khoá tài khoản ${code}?`}
        confirmLabel="Khoá tài khoản"
        busyLabel="Đang khoá…"
        tone="danger"
        busy={actions.busy === "lock"}
        error={dialog === "lock" ? actions.error : null}
        onConfirm={() => void confirm()}
        onClose={() => setDialog(null)}
      >
        <p>
          {user.name ?? user.email} sẽ bị đăng xuất khỏi mọi thiết bị và không đăng nhập được cho tới khi được mở khoá.
        </p>
        <p>
          Lý do: <span className="font-semibold text-ink">{reason.trim()}</span>
        </p>
      </ConfirmUserActionDialog>
      <ConfirmUserActionDialog
        open={dialog === "unlock"}
        title={`Mở khoá tài khoản ${code}?`}
        confirmLabel="Mở khoá"
        busyLabel="Đang mở khoá…"
        tone="primary"
        busy={actions.busy === "unlock"}
        error={dialog === "unlock" ? actions.error : null}
        onConfirm={() => void confirm()}
        onClose={() => setDialog(null)}
      >
        <p>Người dùng đăng nhập lại được và có lại toàn bộ quyền.</p>
      </ConfirmUserActionDialog>
      <ConfirmUserActionDialog
        open={dialog === "role"}
        title={`Đổi vai trò thành ${ROLE_LABELS[role]}?`}
        confirmLabel="Đổi vai trò"
        busyLabel="Đang đổi…"
        tone="primary"
        busy={actions.busy === "role"}
        error={dialog === "role" ? actions.error : null}
        onConfirm={() => void confirm()}
        onClose={() => setDialog(null)}
      >
        <p>
          {ROLE_LABELS[user.role]} → {ROLE_LABELS[role]}. Người dùng bị đăng xuất khỏi mọi phiên và cần đăng nhập lại.
        </p>
      </ConfirmUserActionDialog>
    </section>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "amber" }) {
  return (
    <div className="flex h-14.75 flex-col justify-center rounded-field bg-surface-muted px-2.5">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={`text-[17px] font-extrabold ${tone === "amber" ? "text-tone-amber-fg" : "text-ink"}`}>{value}</dd>
    </div>
  );
}
