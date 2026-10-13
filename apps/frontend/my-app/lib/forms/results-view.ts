import { vietnamDateTimeParts } from "../format/date-time.ts";
import type { AnswerValue, FormResponse, ResultQuestion } from "./results-service.ts";

/**
 * Pure view logic of "Câu trả lời" (Figma 10d 63:3709 / 63:4534, 10d' 63:2033):
 * search, pagination, table columns and answer formatting. No quality filter:
 * responses are never graded in Phase 1 (IR.4a R8, `NOT_ASSESSED`).
 */

/** Lowercase, no Vietnamese diacritics ("Ký túc xá" → "ky tuc xa"), no leading "#". */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** "Tìm theo mã hoặc nội dung": the code ("47ad", "#47AD") or any answer text. */
export function matchesSearch(response: FormResponse, questions: readonly ResultQuestion[], query: string): boolean {
  const needle = normalizeSearchText(query).replace(/^#/, "");
  if (!needle) return true;
  if (normalizeSearchText(response.code).includes(needle)) return true;
  return questions.some((question) => {
    const text = answerText(question, response.answers[question.id] ?? null);
    return text !== "" && normalizeSearchText(text).includes(needle);
  });
}

export function filterResponses(
  responses: readonly FormResponse[],
  questions: readonly ResultQuestion[],
  filter: { query: string },
): FormResponse[] {
  return responses.filter((response) => matchesSearch(response, questions, filter.query));
}

export const RESPONSES_PAGE_SIZE = 10;
/** Mobile list: first cards, then "Xem thêm N câu trả lời". */
export const MOBILE_INITIAL_COUNT = 7;

export interface Page<T> {
  items: T[];
  /** Clamped 1-based page. */
  page: number;
  pageCount: number;
  /** 1-based index of the first/last row shown ("Hiện 1–10 trong 20"); 0 when empty. */
  from: number;
  to: number;
  total: number;
}

export function paginate<T>(items: readonly T[], page: number, pageSize = RESPONSES_PAGE_SIZE): Page<T> {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(Number.isFinite(page) ? page : 1)), pageCount);
  const start = (current - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    items: slice,
    page: current,
    pageCount,
    from: slice.length ? start + 1 : 0,
    to: start + slice.length,
    total,
  };
}

export function parsePage(value: string | null | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export interface ResponsePosition {
  /** 1-based, among every response of the version ("7 / 20"). */
  index: number;
  total: number;
  /** Newer response (left arrow / "‹ #F20E"). */
  previous: FormResponse | null;
  /** Older response (right arrow / "#B8C3 ›"). */
  next: FormResponse | null;
}

export function responsePosition(responses: readonly FormResponse[], id: string): ResponsePosition | null {
  const index = responses.findIndex((response) => response.id === id);
  if (index < 0) return null;
  return {
    index: index + 1,
    total: responses.length,
    previous: responses[index - 1] ?? null,
    next: responses[index + 1] ?? null,
  };
}

/** Table columns shown by default ("Cột · 3/8 câu"): the first questions. */
export const DEFAULT_COLUMN_COUNT = 3;
export const MAX_COLUMNS = 4;

export function defaultColumnIds(questions: readonly ResultQuestion[]): string[] {
  return questions.slice(0, DEFAULT_COLUMN_COUNT).map((question) => question.id);
}

/** Keeps the chosen columns in question order, drops unknown ids, falls back to the defaults. */
export function normalizeColumnIds(questions: readonly ResultQuestion[], ids: readonly string[]): string[] {
  const chosen = questions.filter((question) => ids.includes(question.id)).map((question) => question.id);
  return chosen.length ? chosen.slice(0, MAX_COLUMNS) : defaultColumnIds(questions);
}

/** "C3 · Ngân sách thuê trọ mỗi tháng" (no short labels are stored: the title, truncated by the cell). */
export function columnHeader(question: ResultQuestion): string {
  return `C${question.number} · ${question.title}`;
}

// --- Durations -------------------------------------------------------------

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Table cell: "5p 48s", "7p 05s", "45s"; "—" when unknown (no attempt start, e.g. a guest). */
export function formatDurationShort(totalSeconds: number | null): string {
  if (totalSeconds === null) return "Chưa có";
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes}p ${pad2(rest)}s` : `${rest}s`;
}

/** "6 phút 02 giây", "5 phút", "45 giây"; "—" when unknown. */
export function formatDurationLong(totalSeconds: number | null): string {
  if (totalSeconds === null) return "Chưa có";
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest} giây`;
  return rest ? `${minutes} phút ${pad2(rest)} giây` : `${minutes} phút`;
}

// --- Answers ---------------------------------------------------------------

const isEmpty = (value: AnswerValue | undefined) =>
  value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

function optionLabel(question: ResultQuestion, value: string): string {
  return question.options.find((option) => option.value === value)?.label ?? value;
}

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const lowerFirst = (text: string) => (text ? text[0].toLowerCase() + text.slice(1) : text);

/**
 * Wording of one point of a linear scale: the end labels, and — for a 1–5
 * scale whose ends read "Rất X" / "Rất Y" — "X" (2), "Bình thường" (3), "Y" (4).
 * ASSUMED: the backend stores only the end labels.
 */
export function scalePointLabel(question: ResultQuestion, value: number): string | null {
  const scale = question.scale;
  if (!scale) return null;
  if (value === scale.min) return scale.minLabel;
  if (value === scale.max) return scale.maxLabel;
  const { minLabel, maxLabel } = scale;
  if (scale.max - scale.min !== 4 || !minLabel || !maxLabel) return null;
  const strip = (label: string) => (/^rất\s+/i.test(label) ? capitalize(label.replace(/^rất\s+/i, "")) : null);
  const low = strip(minLabel);
  const high = strip(maxLabel);
  if (!low || !high) return null;
  const offset = value - scale.min;
  return offset === 1 ? low : offset === 2 ? "Bình thường" : offset === 3 ? high : null;
}

/** Selected option labels (chips of a multiple-choice answer). */
export function answerChoices(question: ResultQuestion, value: AnswerValue | undefined): string[] {
  if (isEmpty(value)) return [];
  const values = Array.isArray(value) ? value : [String(value)];
  return values.map((item) => optionLabel(question, item));
}

/** A date answer "YYYY-MM-DD" → "dd/mm/yyyy"; anything else unchanged. */
export function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

/** Full answer text (detail view, search): "2 / 5 · Không hài lòng", "1,5–2,5 triệu đồng". Empty → "". */
export function answerText(question: ResultQuestion, value: AnswerValue | undefined): string {
  if (isEmpty(value)) return "";
  switch (question.type) {
    case "single_choice":
    case "multiple_choice":
      return answerChoices(question, value).join(", ");
    case "linear_scale": {
      const point = Number(value);
      const max = question.scale?.max ?? 5;
      const label = scalePointLabel(question, point);
      return label ? `${point} / ${max} · ${label}` : `${point} / ${max}`;
    }
    case "rating":
      return `${Number(value)} / ${question.scale?.max ?? 5} sao`;
    case "number":
      return typeof value === "number" ? value.toLocaleString("vi-VN") : String(value);
    case "date":
      return formatDate(String(value));
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}

/** Table cell / mobile card: "1,5–2,5 triệu", "3/5". ASSUMED: a trailing currency word is dropped. */
export function answerCompact(question: ResultQuestion, value: AnswerValue | undefined): string {
  if (isEmpty(value)) return "Chưa có";
  if (question.type === "linear_scale" || question.type === "rating") {
    return `${Number(value)}/${question.scale?.max ?? 5}`;
  }
  const text = answerText(question, value);
  return question.type === "single_choice" || question.type === "multiple_choice"
    ? text.replace(/ đồng\b/g, "")
    : text;
}

/** Mobile card line: "Nhà trọ · 1,5–2,5 triệu · hài lòng 3/5". */
export function responseSummary(response: FormResponse, columns: readonly ResultQuestion[]): string {
  return columns
    .map((question, index) => {
      const value = response.answers[question.id];
      const compact = answerCompact(question, value);
      if ((question.type === "linear_scale" || question.type === "rating") && !isEmpty(value)) {
        return `${lowerFirst(question.title)} ${compact}`;
      }
      return index === 0 ? compact : lowerFirst(compact);
    })
    .join(" · ");
}

/** Qualifier after a question title in the detail view ("nhiều lựa chọn", "thang 1–5", "trả lời ngắn"). */
export function questionKindLabel(question: Pick<ResultQuestion, "type" | "scale">): string | null {
  switch (question.type) {
    case "multiple_choice":
      return "nhiều lựa chọn";
    case "linear_scale":
      return `thang ${question.scale?.min ?? 1} đến ${question.scale?.max ?? 5}`;
    case "rating":
      return `${question.scale?.max ?? 5} sao`;
    case "text":
      return "trả lời ngắn";
    case "textarea":
      return "trả lời dài";
    case "number":
      return "nhập số";
    case "date":
      return "ngày";
    case "file_upload":
      return "tải tệp";
    default:
      return null;
  }
}

/** "#47AD" */
export const responseLabel = (response: Pick<FormResponse, "code">) => `#${response.code}`;

/** "22/09 21:14" in Vietnam time. */
export function formatSubmittedAt(value: string): string {
  const parts = vietnamDateTimeParts(value);
  return parts ? `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}` : "";
}
