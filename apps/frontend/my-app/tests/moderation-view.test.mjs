import test from "node:test";
import assert from "node:assert/strict";

test("Epic 8 review P8: clampQueueOffset recovers the last valid page", async () => {
  const { clampQueueOffset } = await import("../app/admin/moderation/moderation-view.ts");

  // Deciding the last item on page 2 (offset 20) with pageSize 20 leaves total=15:
  // the only valid page start is 0.
  assert.equal(clampQueueOffset(20, 15, 20), 0);
  // total=45 -> last page starts at 40.
  assert.equal(clampQueueOffset(60, 45, 20), 40);
  // offset already inside range is left untouched.
  assert.equal(clampQueueOffset(20, 45, 20), 20);
  // total=0 always clamps to 0.
  assert.equal(clampQueueOffset(40, 0, 20), 0);
  // never negative.
  assert.equal(clampQueueOffset(-5, 45, 20), 0);
});

test("Epic 8 review P9: describeModerationError returns Vietnamese copy, never the raw message", async () => {
  const { describeModerationError } = await import("../app/admin/moderation/moderation-view.ts");
  const fallback = "Không thể tải hàng chờ kiểm duyệt.";

  assert.equal(
    describeModerationError({ status: 401 }, fallback),
    "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập bằng tài khoản quản trị.",
  );
  assert.equal(
    describeModerationError({ status: 403, code: "MODERATION_SELF_REVIEW_FORBIDDEN" }, fallback),
    "Bạn không thể tự kiểm duyệt khảo sát do chính mình đăng.",
  );
  assert.equal(
    describeModerationError(
      { status: 403, code: "MODERATION_ADMIN_CAPABILITY_REQUIRED" },
      fallback,
    ),
    "Tài khoản quản trị của bạn không còn hoạt động. Vui lòng đăng nhập lại.",
  );
  assert.equal(
    describeModerationError({ status: 403 }, fallback),
    "Bạn không có quyền kiểm duyệt khảo sát.",
  );
  assert.equal(
    describeModerationError({ code: "MODERATION_VERSION_MISMATCH" }, fallback),
    "Phiên bản khảo sát đã thay đổi. Hãy tải lại bản xem trước rồi quyết định lại.",
  );
  assert.equal(
    describeModerationError({ code: "MODERATION_ALREADY_DECIDED" }, fallback),
    "Khảo sát này đã được xử lý hoặc không còn trong hàng chờ.",
  );
  assert.equal(
    describeModerationError({ code: "FORM_NOT_IN_MODERATION_QUEUE" }, fallback),
    "Khảo sát này đã được xử lý hoặc không còn trong hàng chờ.",
  );
  for (const code of [
    "MODERATION_INVALID_REQUEST",
    "VALIDATION_ERROR",
    "INVALID_MODERATION_REQUEST",
  ]) {
    assert.equal(
      describeModerationError({ status: 400, code }, fallback),
      "Yêu cầu không hợp lệ. Vui lòng tải lại trang.",
    );
  }
  assert.equal(
    describeModerationError({ code: "FORM_NOT_FOUND" }, fallback),
    "Không tìm thấy khảo sát này. Có thể khảo sát đã bị xoá.",
  );
  assert.equal(
    describeModerationError(
      { code: "MODERATION_ESCROW_NOT_FUNDED", details: { shortfall: 120 } },
      fallback,
    ),
    "Khảo sát chưa được ký quỹ đủ: còn thiếu 120 điểm. Không thể duyệt — hãy từ chối để hoàn phần ký quỹ hiện có.",
  );
  assert.equal(
    describeModerationError({ code: "MODERATION_ESCROW_NOT_FUNDED" }, fallback),
    "Khảo sát chưa được ký quỹ đủ. Không thể duyệt — hãy từ chối để hoàn phần ký quỹ hiện có.",
  );
  assert.equal(
    describeModerationError({ code: "FORM_VALIDATION_ERROR" }, fallback),
    "Khảo sát không đạt điều kiện xuất bản (thiếu thông tin bắt buộc hoặc đường dẫn không hợp lệ). Hãy từ chối và yêu cầu người đăng chỉnh sửa.",
  );
  assert.equal(
    describeModerationError({ code: "EXTERNAL_COMPLETION_CODE_REQUIRED" }, fallback),
    "Khảo sát không đạt điều kiện xuất bản (thiếu thông tin bắt buộc hoặc đường dẫn không hợp lệ). Hãy từ chối và yêu cầu người đăng chỉnh sửa.",
  );
  assert.equal(
    describeModerationError(new TypeError("Failed to fetch"), fallback),
    "Không thể kết nối máy chủ. Vui lòng thử lại.",
  );
  // Unknown/unmapped errors fall back to the caller's Vietnamese copy, never
  // the raw (often English) error.message.
  assert.equal(describeModerationError(new Error("Some raw backend message"), fallback), fallback);
  assert.equal(describeModerationError(null, fallback), fallback);
});

test("Decision E8-D2: rejecting a re-submission warns that the live survey closes for good", async () => {
  const { describeRejectionImpact } = await import("../app/admin/moderation/moderation-view.ts");

  const warning = describeRejectionImpact({ isResubmission: true, versionNumber: 3 });
  assert.ok(warning);
  assert.match(warning, /phiên bản chỉnh sửa v3/);
  assert.match(warning, /đóng vĩnh viễn toàn bộ khảo sát/);
  assert.match(warning, /phiên bản đã duyệt trước đó \(v2\)/);
  assert.match(warning, /không thể mở lại/);

  // A first submission closes only itself: no warning.
  assert.equal(describeRejectionImpact({ isResubmission: false, versionNumber: 1 }), null);
});
