import assert from "node:assert/strict";
import test from "node:test";

const ai = await import("../lib/forms/builder-ai.ts");

test("chatTitleFromPrompt keeps at most the first 10 words", () => {
  assert.equal(
    // Vietnamese words are space-separated syllables.
    ai.chatTitleFromPrompt("Nhu cầu nhà trọ gần trường cho sinh viên năm nhất ở Hà Nội."),
    "Nhu cầu nhà trọ gần trường cho sinh viên năm",
  );
  assert.equal(ai.chatTitleFromPrompt("  Khảo sát   căng tin\ntrường  "), "Khảo sát căng tin trường");
});

test("chatTitleFromPrompt drops trailing punctuation and handles empty prompts", () => {
  assert.equal(ai.chatTitleFromPrompt("Đánh giá môn học, sau học kỳ:"), "Đánh giá môn học, sau học kỳ");
  assert.equal(ai.chatTitleFromPrompt("một hai ba bốn năm sáu bảy tám chín mười, mười một"), "một hai ba bốn năm sáu bảy tám chín mười");
  assert.equal(ai.chatTitleFromPrompt("   "), "");
});

test("chatTitleFromPrompt fits the 200-character form title limit", () => {
  const long = Array.from({ length: 10 }, () => "a".repeat(40)).join(" ");
  assert.ok(ai.chatTitleFromPrompt(long).length <= 200);
});

test("formIdFromAiPath reads the draft of an AI chat path", () => {
  assert.equal(ai.formIdFromAiPath("/forms/5a0c1f7e-2b4d/builder/ai"), "5a0c1f7e-2b4d");
  assert.equal(ai.formIdFromAiPath("/forms/abc/builder/ai/"), "abc");
  assert.equal(ai.formIdFromAiPath("/forms/new/builder/ai"), null);
  assert.equal(ai.formIdFromAiPath("/forms/abc/builder"), null);
  assert.equal(ai.formIdFromAiPath("/forms/%E0%A4/builder/ai"), "%E0%A4");
});
