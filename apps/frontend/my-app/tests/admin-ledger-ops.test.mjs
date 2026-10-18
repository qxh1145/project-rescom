import assert from "node:assert/strict";
import { test } from "node:test";
import { MATURED_PENDING_RELEASE_MAX_LIMIT } from "@rescom/schemas";
import {
  TRANSACTIONS_TABS,
  accountClassLabel,
  confirmCopyOf,
  ownerLabel,
  parseRedriveId,
  parseReleaseLimit,
  settlementStatusLabel,
} from "../lib/admin/ledger-ops-view.ts";
import { ledgerOpsErrorMessage } from "../lib/admin/ledger-ops-messages.ts";
import { ApiError } from "../lib/api/api-error.ts";

const UUID = "3f2b8c1e-4d5a-4e6f-8a7b-9c0d1e2f3a4b";

function httpError(status, code) {
  return new ApiError({ kind: "http", status, code, message: "x" });
}

test("tabs: Sổ giao dịch first, Vận hành second", () => {
  assert.deepEqual(
    TRANSACTIONS_TABS.map((tab) => [tab.key, tab.label]),
    [
      ["ledger", "Sổ giao dịch"],
      ["ops", "Vận hành"],
    ],
  );
});

test("parseRedriveId trims, requires a UUID, and never passes bad ids", () => {
  assert.deepEqual(parseRedriveId(`  ${UUID}  `), { id: UUID });
  for (const bad of ["", "   ", "abc", "3f2b8c1e-4d5a-4e6f-8a7b", `${UUID}x`, "../../etc"]) {
    const result = parseRedriveId(bad);
    assert.ok("error" in result && result.error.length > 0, JSON.stringify(bad));
    assert.ok(!("id" in result));
  }
});

test("parseReleaseLimit: empty = server default, integer 1..max, else an error", () => {
  assert.deepEqual(parseReleaseLimit(""), { limit: undefined });
  assert.deepEqual(parseReleaseLimit("   "), { limit: undefined });
  assert.deepEqual(parseReleaseLimit(" 20 "), { limit: 20 });
  assert.deepEqual(parseReleaseLimit("1"), { limit: 1 });
  assert.deepEqual(parseReleaseLimit(String(MATURED_PENDING_RELEASE_MAX_LIMIT)), { limit: MATURED_PENDING_RELEASE_MAX_LIMIT });
  for (const bad of ["0", "-3", String(MATURED_PENDING_RELEASE_MAX_LIMIT + 1), "501", "1.5", "abc", "1e2", "0x10"]) {
    const result = parseReleaseLimit(bad);
    assert.ok("error" in result, bad);
    assert.ok(result.error.includes(String(MATURED_PENDING_RELEASE_MAX_LIMIT)), "error names the max");
  }
});

test("labels: settlement statuses, unknown status falls back to the raw code, account classes reuse the ledger map", () => {
  assert.equal(settlementStatusLabel("SETTLED"), "Đã cộng vào Khả dụng");
  assert.equal(settlementStatusLabel("PENDING"), "Đang chờ 48 giờ");
  assert.equal(settlementStatusLabel("HELD_IN_INTEGRITY"), "Đang tạm giữ kiểm tra");
  assert.equal(settlementStatusLabel("SKIPPED_GUEST"), "Bỏ qua — lượt làm của khách");
  assert.equal(settlementStatusLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(accountClassLabel("USER_AVAILABLE"), "Khả dụng");
  assert.equal(accountClassLabel("ESCROW"), "Ký quỹ");
});

test("ownerLabel: short code of the owner, Hệ thống for system accounts", () => {
  assert.equal(ownerLabel(UUID), "#3F2B");
  assert.equal(ownerLabel(null), "Hệ thống");
});

test("confirm copy names the effect of every mutating action", () => {
  const reconcile = confirmCopyOf({
    kind: "reconcile",
    // The title names the account as its table row does (owner · class), never by the account id.
    account: { accountId: "9c8d0000-0000-4000-8000-000000000001", userId: UUID, accountClass: "USER_AVAILABLE", projectedBalance: 120, calculatedBalance: 100 },
  });
  assert.equal(reconcile.title, "Đối soát tài khoản #3F2B · Khả dụng?");
  assert.equal(
    reconcile.body,
    "Số dư hiển thị sẽ được tính lại bằng tổng các bút toán (hiện 120 → 100 Điểm). Không tạo bút toán mới.",
  );
  assert.equal(reconcile.confirmLabel, "Đối soát");

  const system = confirmCopyOf({
    kind: "reconcile",
    account: { accountId: "a1b2c3d4-0000-4000-8000-000000000001", userId: null, accountClass: "ESCROW", projectedBalance: 5, calculatedBalance: 6 },
  });
  assert.equal(system.title, "Đối soát tài khoản Hệ thống · Ký quỹ?");

  const internal = confirmCopyOf({ kind: "redrive", target: "internal", id: UUID });
  assert.equal(internal.title, "Chạy lại trả thưởng cho bài trả lời #3F2B?");
  assert.equal(
    internal.body,
    "Nếu chưa có khoản thưởng, hệ thống sẽ trả từ Ký quỹ của khảo sát; nếu đã có, chỉ trả về kết quả cũ. Không trả hai lần.",
  );
  assert.equal(internal.confirmLabel, "Chạy lại");
  assert.equal(confirmCopyOf({ kind: "redrive", target: "external", id: UUID }).title, "Chạy lại trả thưởng cho lượt làm #3F2B?");

  const release = confirmCopyOf({ kind: "release" });
  assert.equal(release.title, "Giải phóng Điểm chờ đã đủ 48 giờ?");
  assert.equal(
    release.body,
    "Tối đa 100 khoản thưởng đang chờ quá 48 giờ sẽ được chuyển sang Khả dụng. Khoản đang bị khiếu nại được giữ lại.",
  );
  assert.equal(release.confirmLabel, "Giải phóng");
  assert.ok(confirmCopyOf({ kind: "release", limit: 25, after: "cursor" }).body.startsWith("Tối đa 25 khoản"));
});

test("ledgerOpsErrorMessage maps every documented code, network, 403 and falls back", () => {
  const fallback = "Thao tác chưa thực hiện được. Vui lòng thử lại.";
  const cases = {
    ACCOUNT_NOT_FOUND: "Không tìm thấy tài khoản sổ cái này.",
    RESPONSE_NOT_FOUND: "Không tìm thấy bài trả lời với mã này.",
    SURVEY_NOT_AVAILABLE: "Không tìm thấy lượt làm hoặc khảo sát với mã này.",
    ATTEMPT_NOT_EXTERNAL: "Lượt làm này không thuộc khảo sát Google Forms.",
    REWARD_NOT_SETTLEABLE: "Mục này chưa đủ điều kiện trả thưởng (chưa nộp / chưa hoàn thành hoặc không có yêu cầu thưởng).",
    SURVEY_REWARD_UNAVAILABLE: "Ký quỹ của khảo sát không đủ để trả thưởng.",
    INSUFFICIENT_ESCROW_BALANCE: "Ký quỹ của khảo sát không đủ để trả thưởng.",
    LEDGER_COMMAND_IN_PROGRESS: "Một thao tác khác trên sổ cái đang chạy. Thử lại sau vài giây.",
    INVALID_LEDGER_OPERATION: "Không tiếp tục được lượt trước. Chạy lại từ đầu.",
    VALIDATION_ERROR: "Dữ liệu gửi lên không hợp lệ.",
  };
  for (const [code, message] of Object.entries(cases)) {
    assert.equal(ledgerOpsErrorMessage(httpError(code === "ACCOUNT_NOT_FOUND" ? 404 : 409, code)), message, code);
  }
  assert.equal(
    ledgerOpsErrorMessage(new ApiError({ kind: "network", message: "x" })),
    "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
  );
  assert.equal(
    ledgerOpsErrorMessage(httpError(403, "FORBIDDEN_RESOURCE")),
    "Tài khoản của bạn không có quyền thực hiện thao tác vận hành.",
  );
  assert.equal(ledgerOpsErrorMessage(httpError(500, "SOMETHING_ELSE")), fallback);
  assert.equal(ledgerOpsErrorMessage(new Error("boom")), fallback);
  assert.equal(ledgerOpsErrorMessage(undefined), fallback);
});
