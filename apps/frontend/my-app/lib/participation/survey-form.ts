import {
  MAX_ANSWER_STRING_LENGTH,
  parseStrictIsoDate,
  type FormBlock,
  type InternalFormSubmissionInput,
  type IntegrityEventType,
} from "@rescom/schemas";
import { isFileAttachmentList } from "./file-upload.ts";

/**
 * Pure rules for taking an in-Rescom survey (Figma page 4): section paging,
 * answer validation (Vietnamese copy), progress labels and the submit
 * payload. The backend re-validates everything
 * (`validateAnswersAgainstFormDefinition`); these rules only give early,
 * friendly feedback.
 */

/** ASSUMED: sections are not in the backend form schema yet (see `survey-form-service.ts`). */
export interface SurveySection {
  id: string;
  title: string;
  blockIds: string[];
}

/** Figma 4 shows two questions per page ("Câu 3 – 4 / 8"). */
export const QUESTIONS_PER_PAGE = 2;

/** Used when the form has no sections: one unnamed section. */
export const DEFAULT_SECTION_TITLE = "Câu hỏi";

export interface SurveyPageSection {
  id: string;
  title: string;
  /** 1-based, "Phần 2 · …". */
  number: number;
  firstPage: number;
  lastPage: number;
}

export interface SurveyPage {
  index: number;
  sectionIndex: number;
  blocks: FormBlock[];
  /** 1-based question numbers of the first and last question on the page. */
  firstNumber: number;
  lastNumber: number;
}

export interface SurveyLayout {
  pages: SurveyPage[];
  sections: SurveyPageSection[];
  /** Question number by block id ("3. Bạn mua sắm…"). */
  numbers: Record<string, number>;
  total: number;
}

function orderedBlocks(blocks: readonly FormBlock[]): FormBlock[] {
  return [...blocks].sort((a, b) => a.order - b.order);
}

/**
 * Splits the questions into sections (in section order, blocks by `order`)
 * and pages of `perPage` questions that never span two sections. Blocks that
 * no section lists go to a trailing section so nothing is ever hidden.
 */
export function buildSurveyLayout(
  blocks: readonly FormBlock[],
  sections: readonly SurveySection[] | null | undefined,
  perPage: number = QUESTIONS_PER_PAGE,
): SurveyLayout {
  const sorted = orderedBlocks(blocks);
  const byId = new Map(sorted.map((block) => [block.id, block]));
  const used = new Set<string>();
  const groups: { id: string; title: string; blocks: FormBlock[] }[] = [];

  for (const section of sections ?? []) {
    const members = section.blockIds
      .map((id) => byId.get(id))
      .filter((block): block is FormBlock => block !== undefined && !used.has(block.id))
      .sort((a, b) => a.order - b.order);
    members.forEach((block) => used.add(block.id));
    if (members.length > 0) groups.push({ id: section.id, title: section.title, blocks: members });
  }
  const rest = sorted.filter((block) => !used.has(block.id));
  if (rest.length > 0) {
    groups.push({ id: "rest", title: groups.length === 0 ? DEFAULT_SECTION_TITLE : "Câu hỏi khác", blocks: rest });
  }

  const size = Math.max(1, Math.floor(perPage));
  const pages: SurveyPage[] = [];
  const layoutSections: SurveyPageSection[] = [];
  const numbers: Record<string, number> = {};
  let counter = 0;

  groups.forEach((group, sectionIndex) => {
    const firstPage = pages.length;
    for (let start = 0; start < group.blocks.length; start += size) {
      const slice = group.blocks.slice(start, start + size);
      const firstNumber = counter + 1;
      for (const block of slice) numbers[block.id] = ++counter;
      pages.push({ index: pages.length, sectionIndex, blocks: slice, firstNumber, lastNumber: counter });
    }
    layoutSections.push({
      id: group.id,
      title: group.title,
      number: sectionIndex + 1,
      firstPage,
      lastPage: pages.length - 1,
    });
  });

  return { pages, sections: layoutSections, numbers, total: counter };
}

/** Mobile header "Câu 3 – 4 / 8" (one question: "Câu 8 / 8"). */
export function pageRangeLabel(page: Pick<SurveyPage, "firstNumber" | "lastNumber">, total: number): string {
  return page.firstNumber === page.lastNumber
    ? `Câu ${page.lastNumber} / ${total}`
    : `Câu ${page.firstNumber} – ${page.lastNumber} / ${total}`;
}

/** Desktop header "4/8 câu": questions reached so far (end of the current page). */
export function pageProgressLabel(page: Pick<SurveyPage, "lastNumber">, total: number): string {
  return `${page.lastNumber}/${total} câu`;
}

export function isAnswerProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

export function countAnswered(blocks: readonly FormBlock[], answers: Record<string, unknown>): number {
  return blocks.filter((block) => isAnswerProvided(answers[block.id])).length;
}

function requiredMessage(block: FormBlock): string {
  switch (block.type) {
    case "single_choice":
    case "rating":
    case "linear_scale":
      return "Vui lòng chọn một đáp án.";
    case "multiple_choice":
      return "Vui lòng chọn ít nhất một đáp án.";
    case "date":
      return "Vui lòng chọn ngày.";
    case "file_upload":
      return "Vui lòng tải lên ít nhất một tệp.";
    default:
      return "Vui lòng trả lời câu hỏi này.";
  }
}

function isWholeInRange(value: unknown, min: number, max: number, step = 1): boolean {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max &&
    (value - min) % step === 0
  );
}

/** Vietnamese error for one answer, or null when it is acceptable. */
export function validateAnswer(block: FormBlock, value: unknown): string | null {
  if (!isAnswerProvided(value)) return block.required ? requiredMessage(block) : null;

  switch (block.type) {
    case "text":
    case "textarea": {
      if (typeof value !== "string") return "Câu trả lời phải là văn bản.";
      const text = value.trim();
      const max = block.maxLength ?? MAX_ANSWER_STRING_LENGTH;
      if (block.minLength !== undefined && text.length < block.minLength) {
        return `Cần ít nhất ${block.minLength} ký tự.`;
      }
      if (text.length > max) return `Tối đa ${max} ký tự.`;
      if (block.type === "text" && block.pattern) {
        try {
          if (!new RegExp(block.pattern).test(text)) return "Câu trả lời chưa đúng định dạng.";
        } catch {
          return null;
        }
      }
      return null;
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Vui lòng nhập một số.";
      if (block.integerOnly && !Number.isInteger(value)) return "Vui lòng nhập số nguyên.";
      const tooLow = block.min !== undefined && value < block.min;
      const tooHigh = block.max !== undefined && value > block.max;
      if (tooLow || tooHigh) {
        if (block.min !== undefined && block.max !== undefined) return `Nhập giá trị từ ${block.min} đến ${block.max}.`;
        return block.min !== undefined ? `Giá trị nhỏ nhất là ${block.min}.` : `Giá trị lớn nhất là ${block.max}.`;
      }
      return null;
    }
    case "single_choice":
      return typeof value === "string" && block.options.some((option) => option.value === value)
        ? null
        : "Đáp án không hợp lệ.";
    case "multiple_choice": {
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return "Đáp án không hợp lệ.";
      const known = new Set(block.options.map((option) => option.value));
      if (value.some((item) => !known.has(item)) || new Set(value).size !== value.length) return "Đáp án không hợp lệ.";
      if (block.minSelections !== undefined && value.length < block.minSelections) {
        return `Chọn ít nhất ${block.minSelections} đáp án.`;
      }
      if (block.maxSelections !== undefined && value.length > block.maxSelections) {
        return `Chọn tối đa ${block.maxSelections} đáp án.`;
      }
      return null;
    }
    case "rating":
      return isWholeInRange(value, 1, block.maxRating) ? null : "Đáp án không hợp lệ.";
    case "linear_scale":
      return isWholeInRange(value, block.min, block.max, block.step) ? null : "Đáp án không hợp lệ.";
    case "date":
      return typeof value === "string" && parseStrictIsoDate(value) !== null ? null : "Ngày không hợp lệ.";
    case "file_upload":
      // Only finalized (scanned, CLEAN) uploads are ever stored as the answer.
      if (!isFileAttachmentList(value)) return "Tệp tải lên chưa hợp lệ. Hãy tải lại tệp.";
      return value.length > block.maxFiles ? `Chỉ được tải tối đa ${block.maxFiles} tệp.` : null;
    default:
      return null;
  }
}

/** Errors by block id for the given blocks (empty object = valid). */
export function validateBlocks(blocks: readonly FormBlock[], answers: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const block of blocks) {
    const error = validateAnswer(block, answers[block.id]);
    if (error) errors[block.id] = error;
  }
  return errors;
}

/** Index of the first page holding one of `blockIds`, or -1. */
export function firstPageWith(layout: SurveyLayout, blockIds: Iterable<string>): number {
  const wanted = new Set(blockIds);
  return layout.pages.findIndex((page) => page.blocks.some((block) => wanted.has(block.id)));
}

/** The `answers` record of `POST /responses/:responseId/submit` (`internalFormSubmissionInputSchema`). */
export type SubmissionAnswers = Extract<InternalFormSubmissionInput["answers"], Record<string, unknown>>;

/**
 * `POST /responses/:responseId/submit` answers as a record keyed by block id
 * (the array form cannot carry file attachments): answered questions only,
 * in form order; text is trimmed, multiple-choice values follow the option
 * order, a file question carries its CLEAN `FileAttachmentAnswer` list.
 * Unknown keys (stale drafts) are dropped.
 */
export function toSubmissionAnswers(blocks: readonly FormBlock[], answers: Record<string, unknown>): SubmissionAnswers {
  const result: SubmissionAnswers = {};
  for (const block of orderedBlocks(blocks)) {
    const value = answers[block.id];
    if (!isAnswerProvided(value)) continue;
    if (block.type === "file_upload") {
      if (isFileAttachmentList(value)) {
        result[block.id] = value.map(({ objectId, fileName, fileSize, mimeType }) => ({
          objectId,
          fileName,
          fileSize,
          mimeType,
          status: "CLEAN" as const,
        }));
      }
    } else if (typeof value === "string") {
      result[block.id] = value.trim();
    } else if (Array.isArray(value) && block.type === "multiple_choice") {
      const selected = new Set(value);
      result[block.id] = block.options.map((option) => option.value).filter((item) => selected.has(item));
    } else if (typeof value === "number" || typeof value === "boolean") {
      result[block.id] = value;
    } else if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
      result[block.id] = value;
    }
  }
  return result;
}

const CHOICE_TYPES = new Set<FormBlock["type"]>(["single_choice", "multiple_choice", "rating", "linear_scale", "date"]);

/**
 * Telemetry event for an answer change (never the typed content: FR-58).
 * First answer → SELECTED (choices) / ENTERED (free text); emptied → CLEARED.
 */
export function answerEventType(block: FormBlock, previous: unknown, next: unknown): IntegrityEventType | null {
  const had = isAnswerProvided(previous);
  const has = isAnswerProvided(next);
  if (!had && !has) return null;
  if (had && !has) return "ANSWER_CLEARED";
  if (!had) return CHOICE_TYPES.has(block.type) ? "ANSWER_SELECTED" : "ANSWER_ENTERED";
  return "ANSWER_CHANGED";
}
