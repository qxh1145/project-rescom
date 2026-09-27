import assert from "node:assert/strict";
import test from "node:test";

const canned = await import("../mocks/data/form-ai-canned.ts");
const ai = await import("../lib/forms/builder-ai.ts");
const blocks = await import("../lib/forms/builder-blocks.ts");
const { draftFormDefinitionSchema } = await import("@rescom/schemas");

const OPTIONS = { duration: "UNDER_5", suggestAttentionChecks: true };
const PROMPT = "Tìm hiểu thói quen học nhóm của sinh viên năm 2–3: học bao nhiêu buổi, ở đâu, có hiệu quả không.";

function assertValidDraft(draft) {
  ai.aiDraftSchema.parse(draft);
  const applied = ai.applyAiDraft(blocks.emptyDoc(), draft);
  assert.equal(applied.skipped, 0);
  assert.equal(draftFormDefinitionSchema.safeParse(blocks.toDraftDefinition(applied.doc)).success, true);
  return applied;
}

test("first prompt: Figma 13b' draft — 7 câu, 2 phần, 2 suggested checks (câu 3 và 6)", () => {
  const turn = canned.cannedAssistantTurn(null, PROMPT, OPTIONS);
  assert.equal(turn.messages.length, 2);
  const reply = turn.messages[1];
  assert.match(reply.text, /\*\*7 câu, chia 2 phần\*\*/);
  assert.equal(reply.hasDraft, true);
  assert.match(reply.followUp, /câu 3 và 6/);
  assert.equal(reply.quickReplies[0], "Giữ câu 6, bỏ câu 3");
  const applied = assertValidDraft(turn.draft);
  assert.equal(applied.pending.length, 2);
  assert.equal(applied.doc.title, "Thói quen học nhóm của sinh viên");
});

test("follow-ups edit the draft deterministically and stay valid", () => {
  let turn = canned.cannedAssistantTurn(null, PROMPT, OPTIONS);
  turn = canned.cannedAssistantTurn(turn, "Giữ câu 6, bỏ câu 3", OPTIONS);
  assert.equal(turn.draft.blocks.length, 6);
  assert.equal(assertValidDraft(turn.draft).pending.length, 1);
  turn = canned.cannedAssistantTurn(turn, "Thêm câu về thời gian tự học", OPTIONS);
  assert.equal(turn.draft.blocks.length, 7);
  assert.equal(turn.draft.blocks[3].type, "number");
  turn = canned.cannedAssistantTurn(turn, "Rút gọn còn 5 câu", OPTIONS);
  assert.equal(turn.draft.blocks.length, 5);
  assertValidDraft(turn.draft);
  turn = canned.cannedAssistantTurn(turn, "Giọng văn thân mật hơn", OPTIONS);
  assertValidDraft(turn.draft);
  const unknown = canned.cannedAssistantTurn(turn, "abc", OPTIONS);
  assert.equal(unknown.draft, turn.draft);
  assert.equal(unknown.messages.at(-1).hasDraft, false);
});

test("without attention suggestions and for any topic the draft is valid", () => {
  const plain = canned.cannedAssistantTurn(null, "Khảo sát về ký túc xá", { ...OPTIONS, suggestAttentionChecks: false });
  assert.equal(assertValidDraft(plain.draft).pending.length, 0);
  const canteen = canned.cannedAssistantTurn(null, "Mức độ hài lòng với căng tin trường", OPTIONS);
  assert.equal(canteen.draft.title, "Mức độ hài lòng với căng tin trường");
  assertValidDraft(canteen.draft);
  for (let i = 0; i < 3; i += 1) ai.aiSuggestedBlockSchema.parse({ block: canned.cannedSuggestedBlock(i) });
});
