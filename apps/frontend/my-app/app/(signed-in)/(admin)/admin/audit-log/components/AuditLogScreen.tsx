"use client";

import { useState } from "react";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { fieldClassName } from "@/components/ui/TextField";
import type { AuditLogItem } from "@/lib/admin/audit-log-service";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_OUTCOME_OPTIONS,
  auditLogLoadErrorMessage,
} from "@/lib/admin/audit-log-view";
import { useAuditLog } from "../hooks/use-audit-log";
import { AuditLogTable } from "./AuditLogTable";
import { AuditLogDrawer } from "./AuditLogDrawer";

const LABEL = "text-caption font-semibold text-ink-muted";
const ERROR_TEXT = "text-[12px] font-medium text-danger";

export function AuditLogScreen() {
  const state = useAuditLog();
  const [selectedRow, setSelectedRow] = useState<AuditLogItem | null>(null);

  const readOnlyChip = (
    <span className="inline-flex h-6.5 items-center gap-1 rounded-full bg-surface-subtle px-2.5 text-[12px] font-bold text-ink-strong">
      <Icon name="lock" size={14} />
      Chỉ đọc · không sửa, không xoá
    </span>
  );

  return (
    <AdminPage title="Nhật ký thao tác" meta={readOnlyChip}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex w-full flex-col gap-1.5 sm:w-52">
          <label htmlFor="audit-filter-action" className={LABEL}>
            Hành động
          </label>
          <Select
            id="audit-filter-action"
            height={44}
            options={AUDIT_ACTION_OPTIONS}
            value={state.action}
            onChange={(event) => state.setAction(event.target.value)}
          />
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-56">
          <label htmlFor="audit-filter-user" className={LABEL}>
            Người thực hiện
          </label>
          <input
            id="audit-filter-user"
            type="search"
            value={state.userId}
            onChange={(event) => state.setUserId(event.target.value)}
            aria-invalid={Boolean(state.filterErrors.userId) || undefined}
            aria-describedby={state.filterErrors.userId ? "audit-filter-user-error" : undefined}
            placeholder="UUID người thực hiện"
            className={fieldClassName(Boolean(state.filterErrors.userId), "h-11")}
          />
          {state.filterErrors.userId ? (
            <p id="audit-filter-user-error" className={ERROR_TEXT}>
              {state.filterErrors.userId}
            </p>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-56">
          <label htmlFor="audit-filter-target" className={LABEL}>
            Người bị tác động
          </label>
          <input
            id="audit-filter-target"
            type="search"
            value={state.targetUserId}
            onChange={(event) => state.setTargetUserId(event.target.value)}
            aria-invalid={Boolean(state.filterErrors.targetUserId) || undefined}
            aria-describedby={
              state.filterErrors.targetUserId ? "audit-filter-target-error" : undefined
            }
            placeholder="UUID người bị tác động"
            className={fieldClassName(
              Boolean(state.filterErrors.targetUserId),
              "h-11",
            )}
          />
          {state.filterErrors.targetUserId ? (
            <p id="audit-filter-target-error" className={ERROR_TEXT}>
              {state.filterErrors.targetUserId}
            </p>
          ) : null}
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-44">
          <label htmlFor="audit-filter-outcome" className={LABEL}>
            Kết quả
          </label>
          <Select
            id="audit-filter-outcome"
            height={44}
            options={AUDIT_OUTCOME_OPTIONS}
            value={state.outcome}
            onChange={(event) => state.setOutcome(event.target.value)}
          />
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-40">
          <label htmlFor="audit-filter-start" className={LABEL}>
            Từ ngày
          </label>
          <input
            id="audit-filter-start"
            type="date"
            value={state.startDate}
            onChange={(event) => state.setStartDate(event.target.value)}
            aria-invalid={Boolean(state.filterErrors.dateRange) || undefined}
            aria-describedby={state.filterErrors.dateRange ? "audit-filter-date-error" : undefined}
            className={fieldClassName(
              Boolean(state.filterErrors.dateRange),
              "h-11",
            )}
          />
        </div>

        <div className="flex w-full flex-col gap-1.5 sm:w-40">
          <label htmlFor="audit-filter-end" className={LABEL}>
            Đến ngày
          </label>
          <input
            id="audit-filter-end"
            type="date"
            value={state.endDate}
            onChange={(event) => state.setEndDate(event.target.value)}
            aria-invalid={Boolean(state.filterErrors.dateRange) || undefined}
            aria-describedby={state.filterErrors.dateRange ? "audit-filter-date-error" : undefined}
            className={fieldClassName(
              Boolean(state.filterErrors.dateRange),
              "h-11",
            )}
          />
        </div>

        <p
          className="ml-auto pb-3 text-body-sm text-ink-muted"
          aria-live="polite"
        >
          {state.pagination != null ? `${state.pagination.total} bản ghi` : null}
        </p>
      </div>

      {state.filterErrors.dateRange ? (
        <p id="audit-filter-date-error" className={`mt-1.5 ${ERROR_TEXT}`}>
          {state.filterErrors.dateRange}
        </p>
      ) : null}

      <p className="mt-2 text-caption text-ink-muted">
        Nhật ký này gồm đăng nhập, phân quyền, khoá tài khoản, ghim khảo sát,
        chạy lại Outbox, cộng Điểm thủ công và vận hành sổ cái (đối soát, chạy lại trả thưởng,
        giải phóng Điểm chờ, hoàn tác giao dịch). Thao tác nạp/hoàn tiền nạp, duyệt khảo sát và voucher chưa
        hiển thị ở đây.
      </p>

      {state.error ? (
        <Alert tone="danger" className="mt-4 items-center">
          <span className="flex flex-wrap items-center gap-3">
            {auditLogLoadErrorMessage(state.error)}
            <Button variant="secondary" size="sm" onClick={state.reload}>
              Thử lại
            </Button>
          </span>
        </Alert>
      ) : null}

      <section
        aria-label="Nhật ký thao tác"
        className="mt-4 rounded-[22px] border border-line bg-surface px-6 pt-3 pb-3.5"
      >
        <AuditLogTable
          items={state.items}
          loading={state.loading}
          onSelectRow={setSelectedRow}
        />

        {state.pagination && state.pagination.totalPages > 1 ? (
          <nav
            aria-label="Phân trang nhật ký thao tác"
            className="mt-3 flex items-center justify-end gap-3 border-t border-line-subtle pt-3"
          >
            <span className="text-body-sm text-ink-muted">
              Trang {state.pagination.page}/{state.pagination.totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={state.pagination.page <= 1 || state.loading}
              onClick={() => state.setPage(state.pagination!.page - 1)}
            >
              Trước
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={
                state.pagination.page >= state.pagination.totalPages ||
                state.loading
              }
              onClick={() => state.setPage(state.pagination!.page + 1)}
            >
              Sau
            </Button>
          </nav>
        ) : null}
      </section>

      {selectedRow ? (
        <AuditLogDrawer
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
        />
      ) : null}
    </AdminPage>
  );
}
