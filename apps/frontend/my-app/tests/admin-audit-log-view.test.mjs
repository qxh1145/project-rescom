import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTION_OPTIONS,
  AUDIT_OUTCOME_OPTIONS,
  auditActionLabel,
  auditUserLabel,
  auditLogSearch,
  parseAuditFilters,
  auditMetadataText,
  auditLogLoadErrorMessage,
} from "../lib/admin/audit-log-view.ts";
import { ApiError } from "../lib/api/api-error.ts";

test("auditLogSearch omits empty values and always preserves page and limit", () => {
  const emptySearch = auditLogSearch({});
  assert.equal(emptySearch, "page=1&limit=50");

  const queryParams = auditLogSearch({
    page: 2,
    limit: 25,
    action: "LOGIN_SUCCESS",
    userId: "11111111-1111-1111-1111-111111111111",
    targetUserId: "22222222-2222-2222-2222-222222222222",
    outcome: "SUCCESS",
    startDate: "2026-10-01T00:00:00+07:00",
    endDate: "2026-10-18T23:59:59.999+07:00",
  });

  const parsed = new URLSearchParams(queryParams);
  assert.equal(parsed.get("page"), "2");
  assert.equal(parsed.get("limit"), "25");
  assert.equal(parsed.get("action"), "LOGIN_SUCCESS");
  assert.equal(parsed.get("userId"), "11111111-1111-1111-1111-111111111111");
  assert.equal(parsed.get("targetUserId"), "22222222-2222-2222-2222-222222222222");
  assert.equal(parsed.get("outcome"), "SUCCESS");
  assert.equal(parsed.get("startDate"), "2026-10-01T00:00:00+07:00");
  assert.equal(parsed.get("endDate"), "2026-10-18T23:59:59.999+07:00");
});

test("parseAuditFilters parses valid filters and maps date bounds to +07:00", () => {
  const result = parseAuditFilters({
    action: "USER_ROLE_CHANGED",
    userId: "550e8400-e29b-41d4-a716-446655440000",
    targetUserId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    outcome: "FAILURE",
    startDate: "2026-10-10",
    endDate: "2026-10-15",
    page: 1,
    limit: 50,
  });

  assert.ok(result.query);
  assert.equal(result.query.action, "USER_ROLE_CHANGED");
  assert.equal(result.query.userId, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(result.query.targetUserId, "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
  assert.equal(result.query.outcome, "FAILURE");
  assert.equal(result.query.startDate, "2026-10-10T00:00:00+07:00");
  assert.equal(result.query.endDate, "2026-10-15T23:59:59.999+07:00");
});

test("parseAuditFilters catches invalid UUIDs and start date after end date", () => {
  const badUuidResult = parseAuditFilters({
    userId: "not-a-uuid",
    targetUserId: "also-bad",
  });
  assert.ok(badUuidResult.errors);
  assert.match(badUuidResult.errors.userId, /UUID/);
  assert.match(badUuidResult.errors.targetUserId, /UUID/);

  const badDateResult = parseAuditFilters({
    startDate: "2026-10-20",
    endDate: "2026-10-10",
  });
  assert.ok(badDateResult.errors);
  assert.match(badDateResult.errors.dateRange, /không được sau/);

  const longYearResult = parseAuditFilters({ startDate: "275760-01-01" });
  assert.ok(longYearResult.errors);
  assert.equal(longYearResult.errors.dateRange, "Ngày không hợp lệ.");
});

test("labels format action and user properly including unknown action and null actor", () => {
  assert.ok(Object.keys(AUDIT_ACTION_LABELS).length > 0);
  assert.ok(AUDIT_ACTION_OPTIONS.length > 1);
  assert.equal(AUDIT_OUTCOME_OPTIONS.length, 3);

  assert.equal(auditActionLabel("LOGIN_SUCCESS"), "Đăng nhập");
  assert.equal(auditActionLabel("USER_ROLE_CHANGED"), "Đổi vai trò");
  assert.equal(auditActionLabel("UNKNOWN_FUTURE_ACTION"), "UNKNOWN_FUTURE_ACTION");

  assert.equal(
    auditUserLabel(
      { id: "123e4567-e89b-12d3-a456-426614174000", displayName: "Nguyen Van A" },
      "123e4567-e89b-12d3-a456-426614174000",
    ),
    "Nguyen Van A · #123E",
  );

  assert.equal(
    auditUserLabel({ id: "123e4567-e89b-12d3-a456-426614174000", displayName: null }),
    "#123E",
  );

  assert.equal(
    auditUserLabel(null, "abcdef01-e89b-12d3-a456-426614174000"),
    "#ABCD",
  );

  assert.equal(auditUserLabel(null, null), "Hệ thống");
});

test("auditMetadataText formats objects, arrays, and null", () => {
  assert.equal(auditMetadataText(null), "Không có");
  assert.equal(auditMetadataText(undefined), "Không có");
  assert.equal(
    auditMetadataText({ role: "ADMIN", count: 1 }),
    JSON.stringify({ role: "ADMIN", count: 1 }, null, 2),
  );
  assert.equal(
    auditMetadataText(["item1", "item2"]),
    JSON.stringify(["item1", "item2"], null, 2),
  );
});

test("auditLogLoadErrorMessage maps network, 403, 404, and fallback errors", () => {
  assert.equal(
    auditLogLoadErrorMessage(new ApiError({ kind: "network", message: "Failed to fetch" })),
    "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
  );

  assert.equal(
    auditLogLoadErrorMessage(new ApiError({ kind: "http", status: 403, message: "Forbidden" })),
    "Tài khoản này không có quyền quản trị.",
  );

  assert.equal(
    auditLogLoadErrorMessage(
      new ApiError({ kind: "http", status: 404, code: "AUDIT_LOG_NOT_FOUND", message: "Not found" }),
    ),
    "Không tìm thấy bản ghi.",
  );

  assert.equal(
    auditLogLoadErrorMessage(new Error("Generic error")),
    "Không tải được Nhật ký thao tác. Vui lòng thử lại.",
  );
});
