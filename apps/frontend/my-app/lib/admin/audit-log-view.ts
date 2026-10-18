import { z } from "zod";
import {
  AUDIT_LOG_PAGE_SIZE,
  type AuditLogUserRef,
  type ListAuditLogsQuery,
} from "@rescom/schemas";
import { shortCodeOf } from "./users-view.ts";
import { isApiError } from "../api/api-error.ts";

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN_SUCCESS: "Đăng nhập",
  LOGIN_FAILURE: "Đăng nhập thất bại",
  LOGOUT: "Đăng xuất",
  SESSION_REPLACED: "Phiên bị thay thế",
  REFRESH_ROTATED: "Làm mới phiên",
  REFRESH_REUSE_SUSPECTED: "Nghi dùng lại phiên cũ",
  REFRESH_REUSE_REVOKED: "Thu hồi phiên do dùng lại",
  OAUTH_INTENT_REJECTED: "Từ chối đăng nhập Google",
  OAUTH_INTENT_REPLAYED: "Lặp lại đăng nhập Google",
  IDENTITY_LINKED: "Liên kết Google",
  IDENTITY_UNLINKED: "Huỷ liên kết Google",
  PASSWORD_RESET_REQUESTED: "Yêu cầu đặt lại mật khẩu",
  PASSWORD_RESET_COMPLETED: "Đặt lại mật khẩu",
  USER_STATUS_CHANGED: "Đổi trạng thái tài khoản",
  USER_ROLE_CHANGED: "Đổi vai trò",
  OUTBOX_EVENT_REDRIVEN: "Chạy lại sự kiện Outbox",
  SURVEY_PINNED: "Ghim khảo sát",
  SURVEY_UNPINNED: "Bỏ ghim khảo sát",
};

export const AUDIT_ACTION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tất cả hành động" },
  ...Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({
    value,
    label,
  })),
];

export const AUDIT_OUTCOME_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Tất cả kết quả" },
  { value: "SUCCESS", label: "Thành công" },
  { value: "FAILURE", label: "Thất bại" },
];

export function auditActionLabel(code: string): string {
  return AUDIT_ACTION_LABELS[code] ?? code;
}

export function auditUserLabel(
  ref?: AuditLogUserRef | null,
  id?: string | null,
): string {
  const effectiveId = ref?.id ?? id;
  if (!effectiveId) {
    return "Hệ thống";
  }
  const code = shortCodeOf(effectiveId);
  const name = ref?.displayName?.trim();
  return name ? `${name} · ${code}` : code;
}

export function auditLogSearch(query: Partial<ListAuditLogsQuery>): string {
  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  params.set("limit", String(query.limit ?? AUDIT_LOG_PAGE_SIZE));
  if (query.action?.trim()) params.set("action", query.action.trim());
  if (query.userId?.trim()) params.set("userId", query.userId.trim());
  if (query.targetUserId?.trim()) params.set("targetUserId", query.targetUserId.trim());
  if (query.outcome) params.set("outcome", query.outcome);
  if (query.startDate) params.set("startDate", query.startDate);
  if (query.endDate) params.set("endDate", query.endDate);
  return params.toString();
}

export interface RawAuditFilters {
  action?: string;
  userId?: string;
  targetUserId?: string;
  outcome?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface AuditFilterErrors {
  userId?: string;
  targetUserId?: string;
  dateRange?: string;
}

const uuidSchema = z.string().uuid();

export type ParseAuditFiltersResult =
  | { query: ListAuditLogsQuery; errors?: never }
  | { errors: AuditFilterErrors; query?: never };

export function parseAuditFilters(raw: RawAuditFilters): ParseAuditFiltersResult {
  const errors: AuditFilterErrors = {};

  const trimmedUserId = raw.userId?.trim();
  if (trimmedUserId) {
    const res = uuidSchema.safeParse(trimmedUserId);
    if (!res.success) {
      errors.userId = "ID người thực hiện phải là UUID hợp lệ.";
    }
  }

  const trimmedTargetId = raw.targetUserId?.trim();
  if (trimmedTargetId) {
    const res = uuidSchema.safeParse(trimmedTargetId);
    if (!res.success) {
      errors.targetUserId = "ID người bị tác động phải là UUID hợp lệ.";
    }
  }

  const trimmedStart = raw.startDate?.trim();
  const trimmedEnd = raw.endDate?.trim();
  // `<input type=date>` accepts 5+-digit years the backend rejects; 4-digit years also keep the string compare valid.
  const dateShape = /^\d{4}-\d{2}-\d{2}$/;
  if ((trimmedStart && !dateShape.test(trimmedStart)) || (trimmedEnd && !dateShape.test(trimmedEnd))) {
    errors.dateRange = "Ngày không hợp lệ.";
  } else if (trimmedStart && trimmedEnd && trimmedStart > trimmedEnd) {
    errors.dateRange = "Từ ngày không được sau Đến ngày.";
  }

  if (Object.keys(errors).length > 0) {
    return { errors };
  }

  const query: ListAuditLogsQuery = {
    page: raw.page ?? 1,
    limit: raw.limit ?? AUDIT_LOG_PAGE_SIZE,
  };
  if (raw.action?.trim()) query.action = raw.action.trim();
  if (trimmedUserId) query.userId = trimmedUserId;
  if (trimmedTargetId) query.targetUserId = trimmedTargetId;
  if (raw.outcome === "SUCCESS" || raw.outcome === "FAILURE") {
    query.outcome = raw.outcome;
  }
  if (trimmedStart) {
    query.startDate = `${trimmedStart}T00:00:00+07:00`;
  }
  if (trimmedEnd) {
    query.endDate = `${trimmedEnd}T23:59:59.999+07:00`;
  }

  return { query };
}

export function auditMetadataText(metadata: unknown): string {
  if (metadata === null || metadata === undefined) {
    return "Không có";
  }
  return JSON.stringify(metadata, null, 2);
}

export function auditLogLoadErrorMessage(error: unknown): string {
  if (isApiError(error) && error.kind === "network") {
    return "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";
  }
  if (isApiError(error) && (error.status === 403 || error.code === "FORBIDDEN_RESOURCE")) {
    return "Tài khoản này không có quyền quản trị.";
  }
  if (isApiError(error) && (error.status === 404 || error.code === "AUDIT_LOG_NOT_FOUND")) {
    return "Không tìm thấy bản ghi.";
  }
  return "Không tải được Nhật ký thao tác. Vui lòng thử lại.";
}
