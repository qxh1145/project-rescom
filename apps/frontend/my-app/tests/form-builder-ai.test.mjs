import assert from "node:assert/strict";
import test from "node:test";

const ai = await import("../lib/forms/builder-ai.ts");
const blocks = await import("../lib/forms/builder-blocks.ts");
const { draftFormDefinitionSchema } = await import("@rescom/schemas");

const choice = (id, title, labels, extra = {}) => ({
  id,
  order: 0,
  type: "single_choice",
  title,
  required: true,
  allowOther: false,
  options: labels.map((label, i) => ({ id: `${id}-o${i + 1}`, label, value: `opt_${i + 1}` })),
  ...extra,
});

function draft() {
  return ai.aiDraftSchema.parse({
    title: "Thói quen học nhóm của sinh viên",
    description: "Khảo sát cho môn Phương pháp nghiên cứu.",
    blocks: [
      choice("q1", "Bạn thường học nhóm bao nhiêu buổi mỗi tuần?", ["Không học nhóm", "1 buổi", "2–3 buổi"]),
      choice("q2", "Hãy chọn “Thứ Tư” để tiếp tục.", ["Thứ Hai", "Thứ Tư"], {
        integrity: { attentionCheck: { isAttentionCheck: true, expectedValue: "opt_2", failAction: "FLAG" } },
      }),
      { id: "q3", order: 2, type: "rating", title: "Chấm không gian tự học", required: true, maxRating: 5, ratingShape: "STAR" },
      { id: "q4", order: 3, type: "textarea", title: "Góp ý", required: false },
    ],
    sections: [
      { id: "s1", title: "Thói quen học nhóm", blockIds: ["q1", "q2"] },
      { id: "s2", title: "Trải nghiệm & góp ý", blockIds: ["q3", "q4"] },
    ],
    attentionSuggestions: [
      { blockId: "q2", expectedValue: "opt_2" },
      { blockId: "q3", expectedValue: 9 },
      { blockId: "q4", expectedValue: "x" },
      { blockId: "zz", expectedValue: "opt_1" },
    ],
  });
}

let n = 0;
const makeId = () => `blk-test-${(n += 1).toString().padStart(4, "0")}`;

test("applyAiDraft maps the draft to valid builder blocks with fresh ids and sections", () => {
  const { doc, pending, aiBlockIds, skipped } = ai.applyAiDraft(blocks.emptyDoc(), draft(), makeId);
  assert.equal(skipped, 0);
  assert.equal(doc.title, "Thói quen học nhóm của sinh viên");
  assert.equal(doc.blocks.length, 4);
  assert.ok(doc.blocks.every((block) => block.id.startsWith("blk-test-")));
  assert.deepEqual(doc.blocks.map((b) => b.order), [0, 1, 2, 3]);
  assert.deepEqual(doc.sections.map((s) => [s.title, s.blockIds.length]), [["Thói quen học nhóm", 2], ["Trải nghiệm & góp ý", 2]]);
  assert.deepEqual(aiBlockIds, doc.blocks.map((b) => b.id));
  assert.equal(draftFormDefinitionSchema.safeParse(blocks.toDraftDefinition(doc)).success, true);
  // Attention checks never arrive active; only valid suggestions stay pending.
  assert.equal(doc.blocks[1].integrity?.attentionCheck, undefined);
  assert.deepEqual(pending, [{ blockId: doc.blocks[1].id, expectedValue: "opt_2" }]);
});

test("applyAiDraft skips blocks that fail formBlockSchema", () => {
  const bad = { ...draft(), blocks: [...draft().blocks, { id: "q5", order: 4, type: "single_choice", title: "Thiếu lựa chọn", required: false, allowOther: false, options: [] }] };
  const { doc, skipped } = ai.applyAiDraft(blocks.emptyDoc(), bad, makeId);
  assert.equal(skipped, 1);
  assert.equal(doc.blocks.length, 4);
});

test("confirmAttentionSuggestion activates the check (optionally with another answer)", () => {
  const applied = ai.applyAiDraft(blocks.emptyDoc(), draft(), makeId);
  const target = applied.doc.blocks[1].id;
  const confirmed = ai.confirmAttentionSuggestion(applied.doc, applied.pending, target, "opt_1");
  assert.deepEqual(confirmed.pending, []);
  assert.deepEqual(confirmed.doc.blocks[1].integrity.attentionCheck, { isAttentionCheck: true, expectedValue: "opt_1", failAction: "FLAG" });
  assert.equal(blocks.summarizeDoc(confirmed.doc).attentionNumbers[0], 2);
  // An answer the block cannot accept is refused.
  const refused = ai.confirmAttentionSuggestion(applied.doc, applied.pending, target, "opt_9");
  assert.equal(refused.pending.length, 1);
});

test("dismiss and prune remove suggestions without touching the question", () => {
  const applied = ai.applyAiDraft(blocks.emptyDoc(), draft(), makeId);
  const target = applied.doc.blocks[1].id;
  assert.deepEqual(ai.dismissAttentionSuggestion(applied.pending, target), []);
  const removed = blocks.removeBlock(applied.doc, target);
  assert.deepEqual(ai.prunePendingSuggestions(removed, applied.pending), []);
  assert.equal(ai.prunePendingSuggestions(applied.doc, applied.pending), applied.pending);
});

test("expectedAnswerLabel and boldRuns", () => {
  const applied = ai.applyAiDraft(blocks.emptyDoc(), draft(), makeId);
  assert.equal(ai.expectedAnswerLabel(applied.doc.blocks[1], "opt_2"), "Thứ Tư");
  assert.equal(ai.expectedAnswerLabel(applied.doc.blocks[2], 4), "4 sao");
  assert.deepEqual(ai.boldRuns("Mình soạn **7 câu**, xong."), [
    { text: "Mình soạn ", bold: false },
    { text: "7 câu", bold: true },
    { text: ", xong.", bold: false },
  ]);
});
