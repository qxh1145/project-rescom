import assert from "node:assert/strict";
import test from "node:test";

const blocks = await import("../lib/forms/builder-blocks.ts");
const catalog = await import("../lib/forms/builder-catalog.ts");
const { draftFormDefinitionSchema } = await import("@rescom/schemas");

const {
  addOption,
  addSection,
  changeBlockType,
  duplicateBlockById,
  emptyDoc,
  insertBlock,
  moveBlock,
  moveBlockBy,
  removeBlock,
  removeOption,
  removeSection,
  setAttentionCheck,
  summarizeDoc,
  toDraftDefinition,
  updateBlock,
  validateDraft,
  validateForPublish,
} = blocks;

function docWith(...types) {
  let doc = emptyDoc();
  const ids = [];
  for (const type of types) {
    const result = insertBlock(doc, type);
    doc = result.doc;
    ids.push(result.blockId);
  }
  return { doc, ids };
}

const orders = (doc) => doc.blocks.map((block) => block.order);
const idsOf = (doc) => doc.blocks.map((block) => block.id);

test("insertBlock appends Vietnamese defaults with sequential order", () => {
  const { doc, ids } = docWith("text", "single_choice", "rating");
  assert.deepEqual(orders(doc), [0, 1, 2]);
  assert.deepEqual(idsOf(doc), ids);
  assert.equal(doc.blocks[1].options[0].label, "Lựa chọn 1");
  assert.equal(draftFormDefinitionSchema.safeParse(toDraftDefinition(doc)).success, true);
});

test("insertBlock honours an index and a section", () => {
  const { doc } = docWith("text", "text");
  const { doc: inserted, blockId } = insertBlock(doc, "date", { index: 1 });
  assert.equal(inserted.blocks[1].id, blockId);
  const { doc: sectioned, sectionId } = addSection(inserted);
  const { doc: withBlock, blockId: second } = insertBlock(sectioned, "number", { sectionId });
  assert.deepEqual(withBlock.sections[1].blockIds, [second]);
  assert.equal(withBlock.blocks.at(-1).id, second);
  const definition = toDraftDefinition(withBlock);
  assert.deepEqual(definition.sections, withBlock.sections);
  assert.equal(draftFormDefinitionSchema.safeParse(definition).success, true);
});

test("removeBlock reindexes and drops consistency pairs pointing at it", () => {
  const { doc, ids } = docWith("rating", "rating", "text");
  const paired = blocks.setConsistencyPair(doc.blocks[1], { pairedBlockId: ids[0], rule: "EQUIVALENT" });
  const withPair = updateBlock(doc, ids[1], paired);
  const next = removeBlock(withPair, ids[0]);
  assert.deepEqual(orders(next), [0, 1]);
  assert.equal(next.blocks[0].integrity?.consistencyPair, undefined);
});

test("duplicateBlockById inserts a copy after the original with fresh option values", () => {
  const { doc, ids } = docWith("text", "single_choice");
  const check = updateBlock(doc, ids[1], setAttentionCheck(doc.blocks[1], "opt_2"));
  const { doc: next, blockId } = duplicateBlockById(check, ids[1]);
  assert.equal(next.blocks[2].id, blockId);
  assert.match(next.blocks[2].title, /\(bản sao\)$/);
  assert.notEqual(next.blocks[2].options[0].value, next.blocks[1].options[0].value);
  assert.equal(next.blocks[2].integrity.attentionCheck.expectedValue, next.blocks[2].options[1].value);
  assert.equal(validateDraft(next).form.length, 0);
});

test("moveBlockBy moves one step and stops at the edges", () => {
  const { doc, ids } = docWith("text", "textarea", "number");
  const down = moveBlockBy(doc, ids[0], 1);
  assert.deepEqual(idsOf(down), [ids[1], ids[0], ids[2]]);
  assert.deepEqual(orders(down), [0, 1, 2]);
  assert.equal(moveBlockBy(doc, ids[0], -1), doc);
  assert.equal(moveBlockBy(doc, ids[2], 1), doc);
});

test("moveBlockBy crosses section boundaries", () => {
  const { doc, ids } = docWith("text", "textarea");
  const { doc: sectioned, sectionId } = addSection(doc);
  const { doc: withThird, blockId: third } = insertBlock(sectioned, "number", { sectionId });
  const up = moveBlockBy(withThird, third, -1);
  assert.deepEqual(up.sections[0].blockIds, [ids[0], ids[1], third]);
  assert.deepEqual(up.sections[1].blockIds, []);
  const back = moveBlockBy(up, third, 1);
  assert.deepEqual(back.sections[1].blockIds, [third]);
});

test("moveBlock (drag and drop) places a block inside another section", () => {
  const { doc, ids } = docWith("text", "textarea", "rating");
  const { doc: sectioned, sectionId } = addSection(doc);
  const moved = moveBlock(sectioned, ids[0], sectionId, 0);
  assert.deepEqual(moved.sections[0].blockIds, [ids[1], ids[2]]);
  assert.deepEqual(moved.sections[1].blockIds, [ids[0]]);
  assert.deepEqual(idsOf(moved), [ids[1], ids[2], ids[0]]);
  const flat = moveBlock(docWith("text", "text", "text").doc, "missing", null, 0);
  assert.equal(flat.blocks.length, 3);
});

test("dropBlockAt treats the insertion gap relative to the dragged block", () => {
  const { doc, ids } = docWith("text", "textarea", "number", "date");
  // Gap before index 3 (the 4th card) while dragging the 1st → lands third.
  assert.deepEqual(idsOf(blocks.dropBlockAt(doc, ids[0], null, 3)), [ids[1], ids[2], ids[0], ids[3]]);
  assert.deepEqual(idsOf(blocks.dropBlockAt(doc, ids[3], null, 0)), [ids[3], ids[0], ids[1], ids[2]]);
  // Its own gaps are no-ops.
  assert.equal(blocks.dropBlockAt(doc, ids[1], null, 1), doc);
  assert.equal(blocks.dropBlockAt(doc, ids[1], null, 2), doc);
  const { doc: sectioned, sectionId } = addSection(doc);
  const moved = blocks.dropBlockAt(sectioned, ids[0], sectionId, 0);
  assert.deepEqual(moved.sections[1].blockIds, [ids[0]]);
});

test("removeSection merges its questions into the previous section", () => {
  const { doc, ids } = docWith("text");
  const { doc: two, sectionId } = addSection(doc);
  const { doc: withBlock, blockId } = insertBlock(two, "date", { sectionId });
  const merged = removeSection(withBlock, sectionId);
  assert.equal(merged.sections.length, 1);
  assert.deepEqual(merged.sections[0].blockIds, [ids[0], blockId]);
  assert.equal(removeSection(merged, merged.sections[0].id).sections.length, 0);
  assert.deepEqual(idsOf(merged), [ids[0], blockId]);
});

test("changeBlockType keeps title/required and choice options", () => {
  const { doc, ids } = docWith("single_choice");
  const titled = updateBlock(doc, ids[0], { ...doc.blocks[0], title: "Bạn học ở đâu?", required: true });
  const multi = changeBlockType(titled, ids[0], "multiple_choice");
  assert.equal(multi.blocks[0].type, "multiple_choice");
  assert.equal(multi.blocks[0].title, "Bạn học ở đâu?");
  assert.equal(multi.blocks[0].required, true);
  assert.deepEqual(multi.blocks[0].options, titled.blocks[0].options);
  const text = changeBlockType(multi, ids[0], "text");
  assert.equal(text.blocks[0].type, "text");
  assert.equal("options" in text.blocks[0], false);
});

test("options: add keeps unique values, remove keeps two and cleans the attention answer", () => {
  let block = catalog.createBuilderBlock("single_choice", 0, "b1");
  block = addOption(block);
  assert.deepEqual(block.options.map((o) => o.value), ["opt_1", "opt_2", "opt_3"]);
  block = setAttentionCheck(block, "opt_3");
  const removed = removeOption(block, block.options[2].id);
  assert.equal(removed.options.length, 2);
  assert.equal(removed.integrity?.attentionCheck, undefined);
  assert.equal(removeOption(removed, removed.options[0].id).options.length, 2);
});

test("validateDraft reports block problems in Vietnamese by block id", () => {
  const { doc, ids } = docWith("text", "single_choice");
  const broken = updateBlock(doc, ids[0], { ...doc.blocks[0], title: "  " });
  const badCheck = updateBlock(broken, ids[1], setAttentionCheck(doc.blocks[1], "nope"));
  const issues = validateDraft(badCheck);
  assert.deepEqual(issues.blocks[ids[0]], ["Câu hỏi chưa có nội dung."]);
  assert.deepEqual(issues.blocks[ids[1]], ["Đáp án của câu kiểm tra chú ý không khớp lựa chọn nào."]);
});

function titled(doc, title = "Thói quen học nhóm") {
  return {
    ...doc,
    title,
    blocks: doc.blocks.map((block, i) => ({ ...block, title: `Câu hỏi số ${i + 1}?` })),
  };
}

test("validateForPublish requires a question; drafts may be empty", () => {
  assert.equal(validateDraft(emptyDoc()).form.length, 0);
  assert.deepEqual(validateForPublish({ ...emptyDoc(), title: "Khảo sát A" }).form, ["Form cần ít nhất 1 câu hỏi."]);
  const { doc } = docWith("rating");
  assert.equal(blocks.hasIssues(validateForPublish(titled(doc))), false);
});

test("P2: publishing refuses the default / empty question title and an untitled form, naming the question", () => {
  const { doc, ids } = docWith("rating", "text", "single_choice");
  const named = titled(doc);
  // Question 2 keeps the default title, question 3 is emptied.
  const draft = {
    ...named,
    blocks: named.blocks.map((block, i) =>
      i === 1 ? { ...block, title: catalog.DEFAULT_BLOCK_TITLE } : i === 2 ? { ...block, title: "   " } : block,
    ),
  };
  assert.equal(catalog.DEFAULT_BLOCK_TITLE, "Câu hỏi chưa có tiêu đề");
  // Drafts still save with the default title.
  assert.equal(blocks.hasIssues(validateDraft({ ...draft, blocks: draft.blocks.slice(0, 2) })), false);
  const issues = validateForPublish(draft);
  assert.equal(issues.blocks[ids[0]], undefined);
  assert.deepEqual(issues.blocks[ids[1]], [blocks.DEFAULT_TITLE_ISSUE]);
  assert.equal(issues.blocks[ids[2]].length, 1);
  assert.deepEqual(issues.form, []);
  assert.equal(blocks.publishIssueSummary(draft, issues), `Câu 2: ${blocks.DEFAULT_TITLE_ISSUE} Các câu khác cần sửa: 3.`);

  for (const title of ["", "   ", blocks.UNTITLED_FORM]) {
    const untitled = validateForPublish({ ...named, title });
    assert.deepEqual(untitled.form, [blocks.UNTITLED_FORM_ISSUE], JSON.stringify(title));
    assert.equal(blocks.publishIssueSummary(named, untitled), blocks.UNTITLED_FORM_ISSUE);
  }
  assert.equal(blocks.publishIssueSummary(named, validateForPublish(named)), null);
});

test("C1: validateForPublish applies the 30-minute reservation window", async () => {
  const { MAX_PUBLISHABLE_DURATION_MINUTES } = await import("@rescom/schemas");
  const { doc } = docWith("rating");
  const ok = titled(doc);
  assert.equal(blocks.hasIssues(validateForPublish(ok, { estimatedDurationMinutes: MAX_PUBLISHABLE_DURATION_MINUTES })), false);
  assert.deepEqual(validateForPublish(ok, { estimatedDurationMinutes: MAX_PUBLISHABLE_DURATION_MINUTES + 1 }).form, [
    blocks.RESERVATION_WINDOW_ISSUE,
  ]);
  // 21 paragraphs ≈ 32 minutes of expected effort: too long even without a duration.
  const long = titled(docWith(...Array.from({ length: 21 }, () => "textarea")).doc);
  assert.ok(toDraftDefinition(long).metadata.expectedEffortSeconds > MAX_PUBLISHABLE_DURATION_MINUTES * 60);
  assert.deepEqual(validateForPublish(long).form, [blocks.RESERVATION_WINDOW_ISSUE]);
});

test("toDraftDefinition keeps effort above the FR-14 time barrier and names untitled forms", () => {
  const types = Array.from({ length: 40 }, () => "rating");
  const { doc } = docWith(...types);
  const definition = toDraftDefinition(doc);
  assert.equal(definition.title, "Khảo sát chưa có tên");
  assert.ok(definition.metadata.expectedEffortSeconds >= 80);
  assert.ok(definition.metadata.minTimeBarrierSeconds <= definition.metadata.expectedEffortSeconds);
});

test("summarizeDoc matches Figma 13a: 6 câu · 2 phần · khoảng 5 phút · câu 5 kiểm tra", () => {
  const { doc, ids } = docWith("single_choice", "multiple_choice", "linear_scale");
  const { doc: two, sectionId } = addSection(doc);
  let next = two;
  const added = [];
  for (const type of ["rating", "single_choice", "textarea"]) {
    const result = insertBlock(next, type, { sectionId });
    next = result.doc;
    added.push(result.blockId);
  }
  next = updateBlock(next, added[1], setAttentionCheck(next.blocks[4], "opt_2"));
  assert.deepEqual(summarizeDoc(next), { questionCount: 6, sectionCount: 2, minutes: 5, attentionNumbers: [5] });
  assert.equal(ids.length, 3);
});

test("searchBlockTypes is accent-insensitive", () => {
  assert.deepEqual(catalog.searchBlockTypes("danh gia").map((i) => i.type), ["rating"]);
  assert.deepEqual(catalog.searchBlockTypes("Ngày").map((i) => i.type), ["date"]);
  assert.equal(catalog.searchBlockTypes("").length, 9);
});
