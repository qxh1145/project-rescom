"use client";

import type { KeyboardEvent } from "react";
import { Tag } from "@/components/ui/Tag";
import type { AuditLogItem } from "@/lib/admin/audit-log-service";
import {
  auditActionLabel,
  auditUserLabel,
} from "@/lib/admin/audit-log-view";
import { formatShortDateTime } from "@/lib/format/date-time";

const HEAD =
  "h-10.5 border-b border-line text-left align-middle text-caption font-semibold text-ink-muted";
const CELL = "h-16.25 pr-3 align-middle";

interface AuditLogTableProps {
  items: AuditLogItem[];
  loading: boolean;
  onSelectRow: (item: AuditLogItem) => void;
}

export function AuditLogTable({
  items,
  loading,
  onSelectRow,
}: AuditLogTableProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, item: AuditLogItem) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectRow(item);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table
        className="w-full min-w-[900px] table-fixed border-collapse"
        aria-busy={loading || undefined}
      >
        <caption className="sr-only">Nhật ký thao tác (chỉ đọc)</caption>
        <thead>
          <tr>
            <th scope="col" className={`${HEAD} w-[15%]`}>
              Thời gian
            </th>
            <th scope="col" className={`${HEAD} w-[25%]`}>
              Hành động
            </th>
            <th scope="col" className={`${HEAD} w-[25%]`}>
              Người thực hiện
            </th>
            <th scope="col" className={`${HEAD} w-[22%]`}>
              Người bị tác động
            </th>
            <th scope="col" className={`${HEAD} w-[13%]`}>
              Kết quả
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && items.length === 0
            ? Array.from({ length: 5 }, (_, index) => (
                <tr
                  key={index}
                  className="border-t border-line-subtle first:border-t-0"
                >
                  <td colSpan={5} className={CELL}>
                    <span className="block h-4 w-3/4 animate-pulse rounded bg-surface-subtle" />
                  </td>
                </tr>
              ))
            : null}
          {!loading && items.length === 0 ? (
            <tr>
              <td
                colSpan={5}
                className="py-10 text-center text-body-sm text-ink-muted"
              >
                Không có bản ghi nào khớp bộ lọc.
              </td>
            </tr>
          ) : null}
          {items.map((log) => {
            const actionLabel = auditActionLabel(log.action);
            const isUnknownAction = actionLabel === log.action;

            return (
              <tr
                key={log.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectRow(log)}
                onKeyDown={(e) => handleKeyDown(e, log)}
                className="group cursor-pointer border-t border-line-subtle first:border-t-0 hover:bg-surface-subtle focus-visible:bg-surface-subtle focus-visible:outline-none"
              >
                <td className={`${CELL} text-body-sm text-ink-muted`}>
                  {formatShortDateTime(log.createdAt)}
                </td>
                <td className={CELL}>
                  {isUnknownAction ? (
                    <span className="font-semibold text-ink">{log.action}</span>
                  ) : (
                    <div>
                      <p className="font-semibold text-ink">{actionLabel}</p>
                      <p className="font-mono text-caption text-ink-muted">
                        {log.action}
                      </p>
                    </div>
                  )}
                </td>
                <td className={`${CELL} text-body-sm text-ink`}>
                  {auditUserLabel(log.actor, log.userId)}
                </td>
                <td className={`${CELL} text-body-sm text-ink`}>
                  {auditUserLabel(log.targetUser, log.targetUserId)}
                </td>
                <td className={CELL}>
                  <Tag tone={log.outcome === "SUCCESS" ? "teal" : "danger"}>
                    {log.outcome === "SUCCESS" ? "Thành công" : "Thất bại"}
                  </Tag>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
