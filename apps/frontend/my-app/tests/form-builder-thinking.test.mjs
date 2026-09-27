import assert from "node:assert/strict";
import test from "node:test";

const thinking = await import("../lib/forms/ai-thinking.ts");
const ai = await import("../lib/forms/builder-ai.ts");

const OPTIONS = { duration: "UNDER_5", suggestAttentionChecks: true };
const PROMPT = "Tìm hiểu thói quen học nhóm của sinh viên năm 2–3: học bao nhiêu buổi, ở đâu, có hiệu quả không.";

const choice = (id, title) => ({
  id,
  order: 0,
  type: "single_choice",
  title,
  required: true,
  allowOther: false,
  options: [
    { id: `${id}-o1`, label: "Có", value: "opt_1" },
    { id: `${id}-o2`, label: "Không", value: "opt_2" },
  ],
});

function draft(extraBlocks = 0) {
  const blocks = [
    choice("q1", "Bạn thường học nhóm bao nhiêu buổi mỗi tuần?"),
    choice("q2", "Hãy chọn “Không” để tiếp tục."),
    { id: "q3", order: 2, type: "rating", title: "Chấm không gian tự học", required: true, maxRating: 5, ratingShape: "STAR" },
    { id: "q4", order: 3, type: "textarea", title: "Góp ý", required: false },
  ];
  for (let i = 0; i < extraBlocks; i += 1) blocks.push(choice(`x${i}`, `Câu thêm ${i + 1}`));
  return ai.aiDraftSchema.parse({
    title: "Thói quen học nhóm của sinh viên",
    blocks,
    sections: [
      { id: "s1", title: "Thói quen học nhóm", blockIds: ["q1", "q2"] },
      { id: "s2", title: "Trải nghiệm và góp ý", blockIds: ["q3", "q4"] },
    ],
    attentionSuggestions: [{ blockId: "q2", expectedValue: "opt_2" }],
  });
}

test("first prompt plans 6 steps; without attention checks the check step is left out", () => {
  const withChecks = thinking.planThinking(PROMPT, OPTIONS, false);
  assert.deepEqual(
    withChecks.map((s) => s.id),
    ["read", "length", "sections", "types", "checks", "review"],
  );
  assert.match(withChecks[1].detail, /Dưới 5 phút/);
  const without = thinking.planThinking(PROMPT, { ...OPTIONS, suggestAttentionChecks: false }, false);
  assert.equal(without.some((s) => s.id === "checks"), false);
});

test("a follow-up plans the short edit run", () => {
  assert.deepEqual(
    thinking.planThinking("Rút gọn còn 5 câu", OPTIONS, true).map((s) => s.id),
    ["read", "update", "review"],
  );
});

test("details of finished steps come from the draft that came back", () => {
  const steps = thinking.completeThinking(thinking.planThinking(PROMPT, OPTIONS, false), draft());
  const by = Object.fromEntries(steps.map((s) => [s.id, s]));
  assert.match(by.read.detail, /Thói quen học nhóm của sinh viên/);
  assert.match(by.length.detail, /^4 câu\./);
  assert.equal(by.sections.detail, "2 phần: Thói quen học nhóm · Trải nghiệm và góp ý.");
  assert.deepEqual(by.types.chips, ["Một lựa chọn × 2", "Đánh giá sao", "Đoạn văn"]);
  assert.match(by.checks.detail, /Gợi ý câu 2 làm câu kiểm tra/);
});

test("a follow-up says how the draft changed", () => {
  const plan = thinking.planThinking("Thêm 2 câu", OPTIONS, true);
  const steps = thinking.completeThinking(plan, draft(2), draft());
  assert.equal(steps.find((s) => s.id === "update").detail, "Bản nháp giờ có 6 câu (thêm 2).");
});

test("without a draft the plan finishes unchanged", () => {
  const plan = thinking.planThinking(PROMPT, OPTIONS, false);
  assert.deepEqual(thinking.completeThinking(plan, null), plan);
});

test("steps advance on the clock and the last one waits for the answer", () => {
  assert.equal(thinking.activeStepAt(0, 6, 1000), 0);
  assert.equal(thinking.activeStepAt(2500, 6, 1000), 2);
  assert.equal(thinking.activeStepAt(60_000, 6, 1000), 5);
  assert.equal(thinking.activeStepAt(-5, 6, 1000), 0);
});

test("header labels", () => {
  assert.equal(thinking.thoughtSecondsLabel("running", 6.6), "· 7 giây");
  assert.equal(thinking.thoughtSecondsLabel("done", 0.2), "trong 1 giây");
  assert.equal(thinking.thoughtSecondsLabel("stopped", 6), "sau 6 giây");
  assert.equal(thinking.thoughtStatusLabel("done"), "Đã suy nghĩ");
  assert.equal(thinking.excerpt("a".repeat(100), 10), `${"a".repeat(9)}…`);
});
