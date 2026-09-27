import {
  checkSurveyFitsReservationWindow,
  computeInternalTimeBarrier,
  deleteBlock,
  draftFormDefinitionSchema,
  duplicateBlock,
  formDefinitionSchema,
  generateBlockId,
  generateOptionId,
  MAX_PUBLISHABLE_DURATION_MINUTES,
  reindexBlocks,
  type AttentionCheckConfig,
  type BlockIntegrityMetadata,
  type ConsistencyPairConfig,
  type DraftFormDefinitionInput,
  type FormBlock,
  type FormBlockType,
  type FormSection,
  type FormSettings,
} from "@rescom/schemas";
import { createBuilderBlock, DEFAULT_BLOCK_TITLE } from "./builder-catalog.ts";

/**
 * Form Builder document (Figma 13) and its pure operations. Every operation
 * returns a new document whose `blocks[i].order === i`.
 *
 * Figma groups questions into "Phần 1 · Thói quen học nhóm"… A section is a
 * named, contiguous run of blocks stored in the versioned form definition.
 * `sections: []` means "one unnamed section" (no section headers).
 */
export type BuilderSection = FormSection;

export interface BuilderDoc {
  title: string;
  description: string;
  blocks: FormBlock[];
  sections: BuilderSection[];
  /** Pass-through form settings / metadata of the loaded definition. */
  settings?: Partial<FormSettings>;
  minTimeBarrierSeconds?: number;
}

export const UNTITLED_FORM = "Khảo sát chưa có tên";

export function emptyDoc(): BuilderDoc {
  return { title: "", description: "", blocks: [], sections: [] };
}

export function newSectionId(): string {
  return `sec-${generateBlockId().slice(4, 16)}`;
}

/**
 * Restores the invariants: blocks ordered as their sections list them, every
 * block in exactly one section (strays join the last one), unknown ids
 * dropped, `order` = index.
 */
export function normalizeDoc(doc: BuilderDoc): BuilderDoc {
  if (doc.sections.length === 0) {
    return { ...doc, blocks: reindexBlocks(doc.blocks) };
  }
  const byId = new Map(doc.blocks.map((block) => [block.id, block]));
  const seen = new Set<string>();
  const sections = doc.sections.map((section) => ({
    ...section,
    blockIds: section.blockIds.filter((id) => {
      if (!byId.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    }),
  }));
  const strays = doc.blocks.filter((block) => !seen.has(block.id)).map((block) => block.id);
  if (strays.length > 0) {
    const last = sections[sections.length - 1];
    last.blockIds = [...last.blockIds, ...strays];
  }
  const blocks = sections.flatMap((section) => section.blockIds.map((id) => byId.get(id) as FormBlock));
  return { ...doc, sections, blocks: reindexBlocks(blocks) };
}

export function blockIndex(doc: BuilderDoc, blockId: string): number {
  return doc.blocks.findIndex((block) => block.id === blockId);
}

export function sectionOfBlock(doc: BuilderDoc, blockId: string): BuilderSection | null {
  return doc.sections.find((section) => section.blockIds.includes(blockId)) ?? null;
}

/** Where a new block goes: the end of `sectionId` (or of the last section / the form). */
export interface InsertTarget {
  sectionId?: string | null;
  /** Index inside the section (or the whole form without sections); default: the end. */
  index?: number;
}

function clampIndex(index: number | undefined, length: number): number {
  if (index === undefined || !Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.trunc(index)));
}

function placeBlock(doc: BuilderDoc, block: FormBlock, target: InsertTarget = {}): BuilderDoc {
  if (doc.sections.length === 0) {
    const blocks = [...doc.blocks];
    blocks.splice(clampIndex(target.index, blocks.length), 0, block);
    return normalizeDoc({ ...doc, blocks });
  }
  const sectionIndex = Math.max(
    0,
    target.sectionId ? doc.sections.findIndex((section) => section.id === target.sectionId) : doc.sections.length - 1,
  );
  const sections = doc.sections.map((section, i) => {
    if (i !== sectionIndex) return section;
    const blockIds = [...section.blockIds];
    blockIds.splice(clampIndex(target.index, blockIds.length), 0, block.id);
    return { ...section, blockIds };
  });
  return normalizeDoc({ ...doc, sections, blocks: [...doc.blocks, block] });
}

export function insertBlock(
  doc: BuilderDoc,
  type: FormBlockType,
  target: InsertTarget = {},
): { doc: BuilderDoc; blockId: string } {
  const block = createBuilderBlock(type, doc.blocks.length);
  return { doc: placeBlock(doc, block, target), blockId: block.id };
}

/** Inserts an existing block (e.g. an AI suggestion) with a fresh id. */
export function insertPreparedBlock(
  doc: BuilderDoc,
  block: FormBlock,
  target: InsertTarget = {},
): { doc: BuilderDoc; blockId: string } {
  const id = doc.blocks.some((existing) => existing.id === block.id) ? generateBlockId() : block.id;
  const prepared = { ...block, id, order: doc.blocks.length } as FormBlock;
  return { doc: placeBlock(doc, prepared, target), blockId: id };
}

export function removeBlock(doc: BuilderDoc, blockId: string): BuilderDoc {
  const index = blockIndex(doc, blockId);
  if (index < 0) return doc;
  const sections = doc.sections.map((section) => ({
    ...section,
    blockIds: section.blockIds.filter((id) => id !== blockId),
  }));
  return normalizeDoc({ ...doc, sections, blocks: deleteBlock(doc.blocks, index) });
}

export function duplicateBlockById(doc: BuilderDoc, blockId: string): { doc: BuilderDoc; blockId: string } {
  const index = blockIndex(doc, blockId);
  if (index < 0) return { doc, blockId };
  const original = doc.blocks[index];
  const { updatedBlocks, newBlock } = duplicateBlock(doc.blocks, index);
  const copy = { ...newBlock, title: `${original.title.slice(0, 490)} (bản sao)` } as FormBlock;
  const blocks = updatedBlocks.map((block) => (block.id === copy.id ? copy : block));
  const sections = doc.sections.map((section) => {
    const at = section.blockIds.indexOf(blockId);
    if (at < 0) return section;
    const blockIds = [...section.blockIds];
    blockIds.splice(at + 1, 0, copy.id);
    return { ...section, blockIds };
  });
  return { doc: normalizeDoc({ ...doc, blocks, sections }), blockId: copy.id };
}

/** Moves a block to `index` inside `sectionId` (null = the form without sections). */
export function moveBlock(doc: BuilderDoc, blockId: string, sectionId: string | null, index: number): BuilderDoc {
  const from = blockIndex(doc, blockId);
  if (from < 0) return doc;
  if (doc.sections.length === 0) {
    const blocks = doc.blocks.filter((block) => block.id !== blockId);
    blocks.splice(clampIndex(index, blocks.length), 0, doc.blocks[from]);
    return normalizeDoc({ ...doc, blocks });
  }
  // A flat index (reading order) while sections exist: join the neighbour's section.
  if (sectionId === null) return moveBlockToFlatIndex(doc, blockId, clampIndex(index, doc.blocks.length - 1));
  const sections = doc.sections.map((section) => ({
    ...section,
    blockIds: section.blockIds.filter((id) => id !== blockId),
  }));
  const target = sections.find((section) => section.id === sectionId);
  if (!target) return doc;
  target.blockIds.splice(clampIndex(index, target.blockIds.length), 0, blockId);
  return normalizeDoc({ ...doc, sections });
}

/**
 * Drag and drop: `insertionIndex` is a gap *before* the block currently at
 * that index of the section (0…length), measured with the dragged block still
 * in place. Dropping a block into its own gap (just above or below itself)
 * changes nothing.
 */
export function dropBlockAt(doc: BuilderDoc, blockId: string, sectionId: string | null, insertionIndex: number): BuilderDoc {
  const ids = sectionId === null || doc.sections.length === 0
    ? doc.blocks.map((block) => block.id)
    : doc.sections.find((section) => section.id === sectionId)?.blockIds;
  if (!ids) return doc;
  const from = ids.indexOf(blockId);
  const to = from >= 0 && from < insertionIndex ? insertionIndex - 1 : insertionIndex;
  if (from === to) return doc;
  return moveBlock(doc, blockId, doc.sections.length === 0 ? null : sectionId, to);
}

function moveBlockToFlatIndex(doc: BuilderDoc, blockId: string, flatIndex: number): BuilderDoc {
  const others = doc.blocks.filter((block) => block.id !== blockId).map((block) => block.id);
  const sectionOf = new Map<string, string>();
  for (const section of doc.sections) for (const id of section.blockIds) sectionOf.set(id, section.id);
  const before = others[flatIndex - 1];
  const after = others[flatIndex];
  const targetSection = (before && sectionOf.get(before)) || (after && sectionOf.get(after)) || doc.sections[0].id;
  const section = doc.sections.find((s) => s.id === targetSection) as BuilderSection;
  const inSection = section.blockIds.filter((id) => id !== blockId);
  const position = before && sectionOf.get(before) === targetSection ? inSection.indexOf(before) + 1 : 0;
  return moveBlock(doc, blockId, targetSection, position);
}

/**
 * Keyboard / button reorder (13a "move up/down", 13e): one step in the
 * reading order. At a section boundary the block moves into the neighbouring
 * section (end of the previous / start of the next) instead of jumping over
 * its first question.
 */
export function moveBlockBy(doc: BuilderDoc, blockId: string, delta: -1 | 1): BuilderDoc {
  const index = blockIndex(doc, blockId);
  if (index < 0) return doc;
  if (doc.sections.length === 0) {
    const to = index + delta;
    if (to < 0 || to >= doc.blocks.length) return doc;
    return moveBlock(doc, blockId, null, to);
  }
  const sectionIndex = doc.sections.findIndex((section) => section.blockIds.includes(blockId));
  const section = doc.sections[sectionIndex];
  const inner = section.blockIds.indexOf(blockId);
  const to = inner + delta;
  if (to >= 0 && to < section.blockIds.length) return moveBlock(doc, blockId, section.id, to);
  const neighbour = doc.sections[sectionIndex + delta];
  if (!neighbour) return doc;
  return moveBlock(doc, blockId, neighbour.id, delta < 0 ? neighbour.blockIds.length : 0);
}

export function canMoveBy(doc: BuilderDoc, blockId: string, delta: -1 | 1): boolean {
  return moveBlockBy(doc, blockId, delta) !== doc;
}

export function updateBlock(doc: BuilderDoc, blockId: string, next: FormBlock): BuilderDoc {
  const index = blockIndex(doc, blockId);
  if (index < 0) return doc;
  const blocks = [...doc.blocks];
  blocks[index] = { ...next, id: blockId, order: index } as FormBlock;
  return { ...doc, blocks };
}

const CHOICE_TYPES = new Set<FormBlockType>(["single_choice", "multiple_choice"]);

/** "Loại câu hỏi" select: keeps the question text, required flag and (choice → choice) options. */
export function changeBlockType(doc: BuilderDoc, blockId: string, type: FormBlockType): BuilderDoc {
  const current = doc.blocks[blockIndex(doc, blockId)];
  if (!current || current.type === type) return doc;
  const fresh = createBuilderBlock(type, current.order, current.id);
  const carried = {
    ...fresh,
    title: current.title,
    required: current.required,
    ...(current.description ? { description: current.description } : {}),
  } as FormBlock;
  if (CHOICE_TYPES.has(type) && (current.type === "single_choice" || current.type === "multiple_choice")) {
    (carried as Extract<FormBlock, { type: "single_choice" }>).options = current.options;
    (carried as Extract<FormBlock, { type: "single_choice" }>).allowOther = current.allowOther;
  }
  // An attention check / pair is type-specific: the publisher sets it again.
  return updateBlock(doc, blockId, carried);
}

// --- Choice options (properties panel "Các lựa chọn") ---

type ChoiceBlock = Extract<FormBlock, { type: "single_choice" | "multiple_choice" }>;

export function isChoiceBlock(block: FormBlock): block is ChoiceBlock {
  return block.type === "single_choice" || block.type === "multiple_choice";
}

function nextOptionValue(block: ChoiceBlock): string {
  const used = new Set(block.options.map((option) => option.value));
  let n = block.options.length + 1;
  while (used.has(`opt_${n}`)) n += 1;
  return `opt_${n}`;
}

export function addOption(block: ChoiceBlock, label?: string): ChoiceBlock {
  const value = nextOptionValue(block);
  const n = Number(value.slice(4));
  return { ...block, options: [...block.options, { id: generateOptionId(), label: label ?? `Lựa chọn ${n}`, value }] };
}

export function updateOptionLabel(block: ChoiceBlock, optionId: string, label: string): ChoiceBlock {
  return { ...block, options: block.options.map((option) => (option.id === optionId ? { ...option, label } : option)) };
}

/** Removing an option also drops it from an attention check's expected answer. */
export function removeOption(block: ChoiceBlock, optionId: string): ChoiceBlock {
  if (block.options.length <= 2) return block;
  const removed = block.options.find((option) => option.id === optionId);
  const next: ChoiceBlock = { ...block, options: block.options.filter((option) => option.id !== optionId) };
  const check = block.integrity?.attentionCheck;
  if (removed && check) {
    const expected = check.expectedValue;
    const stillValid = Array.isArray(expected)
      ? expected.filter((value) => value !== removed.value)
      : expected === removed.value
        ? null
        : expected;
    const integrity: BlockIntegrityMetadata = { ...block.integrity };
    if (stillValid === null || (Array.isArray(stillValid) && stillValid.length === 0)) delete integrity.attentionCheck;
    else integrity.attentionCheck = { ...check, expectedValue: stillValid };
    next.integrity = integrity;
  }
  return next;
}

// --- Data quality (integrity metadata) ---

const ATTENTION_TYPES = new Set<FormBlockType>(["single_choice", "multiple_choice", "rating", "linear_scale"]);

export function supportsAttentionCheck(block: FormBlock): boolean {
  return ATTENTION_TYPES.has(block.type);
}

export function isAttentionCheck(block: FormBlock): boolean {
  return block.integrity?.attentionCheck?.isAttentionCheck === true;
}

/** A default expected answer for a freshly toggled attention check. */
export function defaultExpectedValue(block: FormBlock): AttentionCheckConfig["expectedValue"] | null {
  switch (block.type) {
    case "single_choice":
      return block.options[0]?.value ?? null;
    case "multiple_choice":
      return block.options[0] ? [block.options[0].value] : null;
    case "rating":
      return block.maxRating;
    case "linear_scale":
      return block.max;
    default:
      return null;
  }
}

export function setAttentionCheck(
  block: FormBlock,
  expectedValue: AttentionCheckConfig["expectedValue"] | null,
): FormBlock {
  const integrity: BlockIntegrityMetadata = { ...(block.integrity ?? {}) };
  if (expectedValue === null) {
    delete integrity.attentionCheck;
    if (integrity.semanticCategory === "ATTENTION_CHECK") delete integrity.semanticCategory;
  } else {
    integrity.attentionCheck = { isAttentionCheck: true, expectedValue, failAction: "FLAG" };
    integrity.semanticCategory = "ATTENTION_CHECK";
  }
  const next = { ...block } as FormBlock;
  if (Object.keys(integrity).length === 0) delete next.integrity;
  else next.integrity = integrity;
  return next;
}

export function setConsistencyPair(block: FormBlock, pair: ConsistencyPairConfig | null): FormBlock {
  const integrity: BlockIntegrityMetadata = { ...(block.integrity ?? {}) };
  if (pair) integrity.consistencyPair = pair;
  else delete integrity.consistencyPair;
  const next = { ...block } as FormBlock;
  if (Object.keys(integrity).length === 0) delete next.integrity;
  else next.integrity = integrity;
  return next;
}

// --- Sections ---

export function addSection(doc: BuilderDoc, title?: string): { doc: BuilderDoc; sectionId: string } {
  const sectionId = newSectionId();
  if (doc.sections.length === 0 && doc.blocks.length > 0) {
    const first: BuilderSection = { id: newSectionId(), title: "Phần 1", blockIds: doc.blocks.map((b) => b.id) };
    const second: BuilderSection = { id: sectionId, title: title ?? "Phần 2", blockIds: [] };
    return { doc: normalizeDoc({ ...doc, sections: [first, second] }), sectionId };
  }
  const section: BuilderSection = { id: sectionId, title: title ?? `Phần ${doc.sections.length + 1}`, blockIds: [] };
  return { doc: normalizeDoc({ ...doc, sections: [...doc.sections, section] }), sectionId };
}

export function renameSection(doc: BuilderDoc, sectionId: string, title: string): BuilderDoc {
  return { ...doc, sections: doc.sections.map((s) => (s.id === sectionId ? { ...s, title } : s)) };
}

/** Removes a section header; its questions join the previous section (or the next one). */
export function removeSection(doc: BuilderDoc, sectionId: string): BuilderDoc {
  const index = doc.sections.findIndex((section) => section.id === sectionId);
  if (index < 0) return doc;
  if (doc.sections.length <= 1) return normalizeDoc({ ...doc, sections: [] });
  const removed = doc.sections[index];
  const sections = doc.sections.filter((section) => section.id !== sectionId);
  const heir = index > 0 ? index - 1 : 0;
  sections[heir] = {
    ...sections[heir],
    blockIds: index > 0 ? [...sections[heir].blockIds, ...removed.blockIds] : [...removed.blockIds, ...sections[heir].blockIds],
  };
  return normalizeDoc({ ...doc, sections });
}

// --- Summary / effort ---

/**
 * ASSUMED effort per question type (seconds) for "khoảng N phút": Figma 13a
 * reads "6 câu · khoảng 5 phút" for its six questions; the backend only
 * stores `metadata.expectedEffortSeconds`.
 */
const EFFORT_SECONDS: Record<FormBlockType, number> = {
  text: 30,
  textarea: 90,
  number: 20,
  single_choice: 40,
  multiple_choice: 50,
  rating: 30,
  linear_scale: 35,
  date: 20,
  file_upload: 60,
};
const INTRO_SECONDS = 15;

export function estimateEffortSeconds(blocks: readonly FormBlock[]): number {
  if (blocks.length === 0) return 0;
  return INTRO_SECONDS + blocks.reduce((sum, block) => sum + EFFORT_SECONDS[block.type], 0);
}

export function estimateMinutes(blocks: readonly FormBlock[]): number {
  return Math.max(1, Math.ceil(estimateEffortSeconds(blocks) / 60));
}

export interface DocSummary {
  questionCount: number;
  sectionCount: number;
  minutes: number;
  /** 1-based question numbers of the attention checks. */
  attentionNumbers: number[];
}

export function summarizeDoc(doc: BuilderDoc): DocSummary {
  return {
    questionCount: doc.blocks.length,
    sectionCount: doc.sections.length,
    minutes: estimateMinutes(doc.blocks),
    attentionNumbers: doc.blocks.flatMap((block, i) => (isAttentionCheck(block) ? [i + 1] : [])),
  };
}

// --- Definition + validation ---

/** The `schema` sent with `PATCH /forms/:id/draft` (VERIFIED `draftFormDefinitionSchema`). */
export function toDraftDefinition(doc: BuilderDoc): DraftFormDefinitionInput {
  const blocks = reindexBlocks(doc.blocks);
  const barrier = computeInternalTimeBarrier({ blocks, metadata: { minTimeBarrierSeconds: doc.minTimeBarrierSeconds ?? 15 } });
  const expectedEffortSeconds = Math.min(86_400, Math.max(10, estimateEffortSeconds(blocks), barrier.requiredSeconds));
  const minTimeBarrierSeconds = Math.min(doc.minTimeBarrierSeconds ?? 15, expectedEffortSeconds);
  return {
    schemaVersion: 1,
    title: doc.title.trim() || UNTITLED_FORM,
    ...(doc.description.trim() ? { description: doc.description.trim() } : {}),
    blocks,
    ...(doc.sections.length > 0 ? { sections: doc.sections } : {}),
    settings: { ...(doc.settings ?? {}) },
    metadata: { expectedEffortSeconds, minTimeBarrierSeconds },
  };
}

export interface DocIssues {
  /** Messages per block id (Vietnamese). */
  blocks: Record<string, string[]>;
  form: string[];
}

export function hasIssues(issues: DocIssues): boolean {
  return issues.form.length > 0 || Object.keys(issues.blocks).length > 0;
}

function blockMessage(path: readonly (string | number)[]): string {
  const [field, , sub] = path;
  if (field === "title") return "Câu hỏi chưa có nội dung.";
  if (field === "options" && sub === "label") return "Có lựa chọn đang để trống.";
  if (field === "options" && (sub === "value" || sub === "id")) return "Có hai lựa chọn trùng nhau.";
  if (field === "options") return "Cần ít nhất 2 lựa chọn.";
  if (field === "integrity" && path.includes("expectedValue")) return "Đáp án của câu kiểm tra chú ý không khớp lựa chọn nào.";
  if (field === "integrity" && path.includes("pairedBlockId")) return "Câu liên kết nhất quán không hợp lệ.";
  if (field === "minSelections" || field === "maxSelections") return "Số lựa chọn tối thiểu/tối đa không hợp lệ.";
  if (field === "min" || field === "max" || field === "step") return "Khoảng giá trị chưa hợp lệ.";
  if (field === "minDate" || field === "maxDate") return "Khoảng ngày chưa hợp lệ.";
  if (field === "allowedMimeTypes") return "Chọn ít nhất một loại tệp được phép.";
  return "Thiết lập của câu hỏi chưa hợp lệ.";
}

function collectIssues(doc: BuilderDoc, forPublish: boolean): DocIssues {
  const definition = toDraftDefinition(doc);
  const parsed = (forPublish ? formDefinitionSchema : draftFormDefinitionSchema).safeParse(definition);
  const issues: DocIssues = { blocks: {}, form: [] };
  if (parsed.success) return issues;
  for (const issue of parsed.error.issues) {
    const [root, index, ...rest] = issue.path;
    if (root === "blocks" && typeof index === "number" && doc.blocks[index]) {
      const id = doc.blocks[index].id;
      const message = blockMessage(rest);
      const list = (issues.blocks[id] ??= []);
      if (!list.includes(message)) list.push(message);
    } else if (root === "blocks") {
      if (!issues.form.includes("Form cần ít nhất 1 câu hỏi.")) issues.form.push("Form cần ít nhất 1 câu hỏi.");
    } else if (root === "title") {
      issues.form.push("Tên khảo sát chưa hợp lệ.");
    } else if (root === "description") {
      issues.form.push("Mô tả quá dài (tối đa 2.000 ký tự).");
    } else if (!issues.form.includes("Thời lượng khảo sát chưa hợp lệ.")) {
      issues.form.push("Thời lượng khảo sát chưa hợp lệ.");
    }
  }
  return issues;
}

/** Draft rules (what `PATCH /forms/:id/draft` accepts). */
export function validateDraft(doc: BuilderDoc): DocIssues {
  return collectIssues(doc, false);
}

export const UNTITLED_FORM_ISSUE = "Hãy đặt tên cho khảo sát trước khi gửi duyệt.";
export const DEFAULT_TITLE_ISSUE = "Câu hỏi còn tiêu đề mặc định. Hãy nhập nội dung câu hỏi.";
export const RESERVATION_WINDOW_ISSUE = `Khảo sát dài hơn ${MAX_PUBLISHABLE_DURATION_MINUTES} phút chưa được hỗ trợ: mỗi lượt làm bài chỉ được giữ chỗ ${MAX_PUBLISHABLE_DURATION_MINUTES} phút. Hãy bớt câu hỏi hoặc giảm thời lượng.`;

function pushUnique(list: string[], message: string): void {
  if (!list.includes(message)) list.push(message);
}

/**
 * Publish rules: `formDefinitionSchema` (at least one question, effort ≥ time
 * barrier), a real form title and question titles (P2), and the 30-minute
 * attempt reservation (`checkSurveyFitsReservationWindow`, decision E5-D2 —
 * the backend answers 422 `SURVEY_DURATION_EXCEEDS_RESERVATION`).
 */
export function validateForPublish(
  doc: BuilderDoc,
  options: { estimatedDurationMinutes?: number | null } = {},
): DocIssues {
  const issues = collectIssues(doc, true);
  const title = doc.title.trim();
  if (title === "" || title === UNTITLED_FORM) pushUnique(issues.form, UNTITLED_FORM_ISSUE);
  for (const block of doc.blocks) {
    const blockTitle = block.title.trim();
    if (blockTitle === "" || blockTitle === DEFAULT_BLOCK_TITLE) {
      const list = (issues.blocks[block.id] ??= []);
      if (!list.includes("Câu hỏi chưa có nội dung.")) pushUnique(list, DEFAULT_TITLE_ISSUE);
    }
  }
  const reservation = checkSurveyFitsReservationWindow({
    type: "INTERNAL",
    definition: toDraftDefinition(doc),
    estimatedDurationMinutes: options.estimatedDurationMinutes ?? null,
  });
  if (!reservation.fits) pushUnique(issues.form, RESERVATION_WINDOW_ISSUE);
  return issues;
}

/**
 * The one-line summary shown when publishing is refused: a form-level issue
 * first, otherwise the first flagged question by number ("Câu 3: …").
 */
export function publishIssueSummary(doc: BuilderDoc, issues: DocIssues): string | null {
  if (issues.form.length > 0) return issues.form[0];
  const numbers = doc.blocks.flatMap((block, i) => (issues.blocks[block.id]?.length ? [i + 1] : []));
  if (numbers.length === 0) return null;
  const first = doc.blocks[numbers[0] - 1];
  const more = numbers.length > 1 ? ` Các câu khác cần sửa: ${numbers.slice(1).join(", ")}.` : "";
  return `Câu ${numbers[0]}: ${issues.blocks[first.id][0]}${more}`;
}
