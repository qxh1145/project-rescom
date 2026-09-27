import assert from "node:assert/strict";
import test from "node:test";

const messages = await import("../lib/forms/builder-messages.ts");
const { ApiError } = await import("../lib/api/api-error.ts");

const http = (code, status) => new ApiError({ kind: "http", message: code ?? "x", status, code });

test("C1 / C3: every publish refusal code has Vietnamese copy", () => {
  const codes = [
    ["SURVEY_DURATION_EXCEEDS_RESERVATION", 422, /30 phút/],
    ["FORM_PUBLISHED_FIELDS_IMMUTABLE", 409, /giữ nguyên điểm thưởng/],
    ["EXPECTED_COMPLETIONS_BELOW_COMMITTED", 422, /Số mẫu không được thấp hơn/],
    ["FORM_VALIDATION_ERROR", 422, /chưa đủ điều kiện gửi duyệt/],
    ["ESTIMATED_DURATION_REQUIRED", 422, /thời lượng dự kiến/],
    ["INVALID_STATUS_TRANSITION", 409, /Trạng thái khảo sát vừa thay đổi/],
  ];
  const fallback = messages.publishErrorMessage(http("SOMETHING_ELSE", 400));
  for (const [code, status, pattern] of codes) {
    const message = messages.publishErrorMessage(http(code, status));
    assert.match(message, pattern, code);
    assert.notEqual(message, fallback, code);
  }
});

test("C5: AI conversation load outcomes", () => {
  assert.deepEqual(messages.aiConversationLoadOutcome(http("AI_CONVERSATION_NOT_FOUND", 404)), { kind: "empty" });
  // A missing AI route is "AI chưa sẵn sàng", never "Không tìm thấy khảo sát".
  for (const error of [http(null, 404), http("NOT_FOUND", 404), http(null, 501)]) {
    const outcome = messages.aiConversationLoadOutcome(error);
    assert.equal(outcome.kind, "error");
    assert.match(outcome.message, /chưa sẵn sàng/);
    assert.doesNotMatch(outcome.message, /Không tìm thấy khảo sát/);
  }
  assert.match(messages.aiConversationLoadOutcome(http("FORM_NOT_FOUND", 404)).message, /Không tìm thấy khảo sát/);
  assert.match(messages.aiConversationLoadOutcome(http("FORM_FORBIDDEN", 403)).message, /không có quyền/);
  assert.match(messages.aiConversationLoadOutcome(new ApiError({ kind: "network", message: "x" })).message, /kết nối/);
});

test("C5: AI send errors are AI errors; draft creation errors stay draft errors", () => {
  assert.match(messages.aiErrorMessage(http(null, 501)), /chưa sẵn sàng/);
  assert.match(messages.aiErrorMessage(http(null, 429)), /hơi nhanh/);
  assert.match(messages.aiErrorMessage(http("INTERNAL", 500)), /Trợ lý chưa phản hồi/);
  assert.match(messages.createDraftErrorMessage(http("INTERNAL", 500)), /Chưa tạo được bản nháp/);
});
