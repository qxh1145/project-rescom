"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Tag } from "@/components/ui/Tag";
import {
  getAuditLog,
  type AuditLogItem,
} from "@/lib/admin/audit-log-service";
import {
  auditActionLabel,
  auditMetadataText,
} from "@/lib/admin/audit-log-view";
import { shortCodeOf } from "@/lib/admin/users-view";
import { useApiQuery } from "@/lib/api/use-api-query";
import { vietnamDateTimeParts } from "@/lib/format/date-time";

interface AuditLogDrawerProps {
  row: AuditLogItem;
  onClose: () => void;
}

export function AuditLogDrawer({ row, onClose }: AuditLogDrawerProps) {
  const detail = useApiQuery(`admin:audit-log:${row.id}`, (signal) =>
    getAuditLog(row.id, signal),
  );

  const log = detail.data ?? row;
  const parts = vietnamDateTimeParts(log.createdAt);
  const fullDateTime = parts
    ? `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`
    : "Không có";

  const is404 =
    detail.error?.status === 404 ||
    detail.error?.code === "AUDIT_LOG_NOT_FOUND";

  return (
    <Dialog
      open
      onClose={onClose}
      labelledBy="audit-log-drawer-title"
      width={560}
      className="lg:mr-0 lg:my-0 lg:h-dvh lg:max-h-dvh lg:rounded-r-none"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-start justify-between border-b border-line p-6">
          <div>
            <h2
              id="audit-log-drawer-title"
              className="text-xl font-extrabold text-ink"
            >
              Chi tiết nhật ký thao tác
            </h2>
            <div className="mt-2 flex items-center gap-2">
              <Tag tone={log.outcome === "SUCCESS" ? "teal" : "danger"}>
                {log.outcome === "SUCCESS" ? "Thành công" : "Thất bại"}
              </Tag>
              <Tag tone="neutral">{log.action}</Tag>
            </div>
            <p className="mt-2 text-body-sm text-ink-muted">
              {auditActionLabel(log.action)} · {fullDateTime}
            </p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={onClose} />
        </header>

        <div className="grid flex-1 content-start gap-5 overflow-y-auto p-6 text-body-sm">
          {detail.error ? (
            <Alert tone="danger" className="items-center justify-between">
              <span>
                {is404
                  ? "Không tìm thấy bản ghi"
                  : "Không tải được chi tiết bản ghi."}
              </span>
              {is404 ? (
                <Button variant="secondary" size="sm" onClick={onClose}>
                  Đóng
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={detail.reload}>
                  Thử lại
                </Button>
              )}
            </Alert>
          ) : null}

          <section className="grid gap-2 rounded-field border border-line p-4">
            <h3 className="font-bold text-ink">Thời gian</h3>
            <p className="text-body-sm text-ink-muted">{fullDateTime}</p>
          </section>

          <section className="grid gap-2 rounded-field border border-line p-4">
            <h3 className="font-bold text-ink">Hành động</h3>
            <div className="flex items-center gap-2">
              <span className="font-medium text-ink">
                {auditActionLabel(log.action)}
              </span>
              <Tag tone="neutral">{log.action}</Tag>
            </div>
          </section>

          <section className="grid gap-2 rounded-field border border-line p-4">
            <h3 className="font-bold text-ink">Kết quả</h3>
            <div>
              <Tag tone={log.outcome === "SUCCESS" ? "teal" : "danger"}>
                {log.outcome === "SUCCESS" ? "Thành công" : "Thất bại"}
              </Tag>
            </div>
          </section>

          <section className="grid gap-2 rounded-field border border-line p-4">
            <h3 className="font-bold text-ink">Người thực hiện</h3>
            {log.userId ? (
              <div className="space-y-1">
                <p className="font-medium text-ink">
                  {log.actor?.displayName ? `${log.actor.displayName} · ` : ""}
                  {shortCodeOf(log.userId)}
                </p>
                <p className="font-mono text-caption text-ink-muted break-all">
                  {log.userId}
                </p>
                <Link
                  href={`/admin/users?id=${encodeURIComponent(log.userId)}`}
                  className="inline-block text-caption font-semibold text-primary hover:underline"
                >
                  Xem hồ sơ người dùng ›
                </Link>
              </div>
            ) : (
              <p className="text-body-sm text-ink-muted">Hệ thống</p>
            )}
          </section>

          <section className="grid gap-2 rounded-field border border-line p-4">
            <h3 className="font-bold text-ink">Người bị tác động</h3>
            {log.targetUserId ? (
              <div className="space-y-1">
                <p className="font-medium text-ink">
                  {log.targetUser?.displayName
                    ? `${log.targetUser.displayName} · `
                    : ""}
                  {shortCodeOf(log.targetUserId)}
                </p>
                <p className="font-mono text-caption text-ink-muted break-all">
                  {log.targetUserId}
                </p>
                <Link
                  href={`/admin/users?id=${encodeURIComponent(
                    log.targetUserId,
                  )}`}
                  className="inline-block text-caption font-semibold text-primary hover:underline"
                >
                  Xem hồ sơ người dùng ›
                </Link>
              </div>
            ) : (
              <p className="text-body-sm text-ink-muted">Không có</p>
            )}
          </section>

          <section className="grid gap-2 rounded-field border border-line p-4">
            <h3 className="font-bold text-ink">Mã lỗi (errorCode)</h3>
            <p className="font-mono text-body-sm text-ink-muted">
              {log.errorCode ?? "Không có"}
            </p>
          </section>

          <section className="grid gap-2 rounded-field border border-line p-4">
            <h3 className="font-bold text-ink">Dữ liệu chi tiết (Metadata)</h3>
            <pre
              tabIndex={0}
              className="max-h-60 overflow-auto rounded-field bg-surface-subtle p-3 text-caption font-mono text-ink whitespace-pre-wrap break-all"
            >
              {auditMetadataText(log.metadata)}
            </pre>
          </section>
        </div>

        <footer className="flex justify-end border-t border-line p-5">
          <Button variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </footer>
      </div>
    </Dialog>
  );
}
