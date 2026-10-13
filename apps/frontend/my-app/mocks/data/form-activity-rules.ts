import type { FormBlock, SurveyFeedbackIssueTag } from "@rescom/schemas";
import type { MockAnswer, MockFormResponse, MockQualitySnapshot } from "./form-responses";
import type { MockFormTracking, OpensRange } from "./forms-manage";

/**
 * Pure generators of MOCK-ONLY survey activity (no MSW, no storage), used by
 * `form-activity.ts` for Form Builder (In-Rescom) surveys that have no seeded
 * data: answers that fit each block, the Figma 10a tracking (opens chart,
 * started/abandoned, ratings) and the Figma 17 quality snapshot. Everything is
 * derived from a seeded PRNG, so one survey always gets the same numbers.
 * Unit-tested in `tests/form-activity.test.mjs`.
 */

export type Rng = () => number;

/** mulberry32 over a string hash — deterministic per seed. */
export function createRng(seed: string): Rng {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  let state = hash >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const between = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

function weightedIndex(rng: Rng, weights: readonly number[]): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];
    if (roll < 0) return index;
  }
  return weights.length - 1;
}

/** Splits `total` into `weights.length` whole parts proportional to the weights. */
export function distribute(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((weight) => (weight / sum) * total);
  const parts = raw.map(Math.floor);
  let left = total - parts.reduce((acc, part) => acc + part, 0);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

// --- Answers ---

const COMMENTS = [
  "Nên có thêm chỗ ngồi gần ổ cắm điện.",
  "Mọi thứ ổn, mong duy trì như hiện tại.",
  "Mạng không dây hay chập chờn vào giờ cao điểm.",
  "Giờ mở cửa nên kéo dài hơn vào mùa thi.",
  "Thông tin nên được cập nhật thường xuyên hơn.",
  "Mình thấy khá hài lòng, không có góp ý thêm.",
  "Cần hướng dẫn rõ ràng hơn cho sinh viên năm nhất.",
  "Giá hơi cao so với chất lượng.",
  "Nên có thêm lựa chọn phù hợp với sinh viên.",
  "Không gian hơi ồn vào buổi chiều.",
  "Thủ tục còn rườm rà, mất nhiều thời gian.",
  "Nhân viên hỗ trợ nhiệt tình.",
  "Muốn có thêm kênh phản hồi trực tuyến.",
  "Tạm ổn.",
];

const SHORT_TEXTS = ["Không có", "Tạm ổn", "Ổn", "Chưa rõ", "Có", "Thỉnh thoảng", "Hầu như mỗi ngày", "Cuối tuần"];

/** Per-question popularity of each option (the same for every respondent of a survey). */
function optionWeights(seed: string, block: FormBlock, count: number): number[] {
  const rng = createRng(`${seed}:weights:${block.id}`);
  return Array.from({ length: count }, (_, index) => 0.4 + rng() * (index === 0 ? 3 : 2));
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

function numberAnswer(block: Extract<FormBlock, { type: "number" }>, rng: Rng): number {
  const min = block.min ?? Math.min(0, block.max ?? 0);
  const max = block.max ?? Math.max(min + 10, 10);
  let value = min + rng() * rng() * (max - min);
  if (block.step) value = Math.min(max, min + Math.round((value - min) / block.step) * block.step);
  return block.integerOnly ? Math.min(max, Math.max(min, Math.round(value))) : Number(value.toFixed(2));
}

/** A pool entry within the length bounds, else one cut / repeated to fit. */
function textAnswer(pool: readonly string[], rng: Rng, minLength = 0, maxLength = Number.POSITIVE_INFINITY): string {
  const fitting = pool.filter((text) => text.length >= minLength && text.length <= maxLength);
  if (fitting.length) return fitting[between(rng, 0, fitting.length - 1)];
  let text = pool[between(rng, 0, pool.length - 1)];
  while (text.length < minLength) text = `${text} ${text}`;
  return text.slice(0, maxLength);
}

function parsedDay(value: string | undefined, fallback: number): number {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : fallback;
}

/**
 * One answer that passes the block's own rules; optional blocks are sometimes
 * skipped (and always when a text `pattern` can't be met with canned text).
 */
export function answerFor(block: FormBlock, rng: Rng, seed: string, now = Date.now()): MockAnswer {
  if (!block.required && rng() < 0.15) return null;
  switch (block.type) {
    case "single_choice": {
      const index = weightedIndex(rng, optionWeights(seed, block, block.options.length));
      return block.options[index]?.value ?? null;
    }
    case "multiple_choice": {
      const weights = optionWeights(seed, block, block.options.length);
      const least = Math.min(block.options.length, block.minSelections ?? 1);
      const most = Math.max(least, Math.min(block.options.length, block.maxSelections ?? block.options.length, 3));
      const wanted = between(rng, least, most);
      const picks = new Set<string>();
      while (picks.size < wanted) picks.add(block.options[weightedIndex(rng, weights)].value);
      return block.options.filter((option) => picks.has(option.value)).map((option) => option.value);
    }
    case "linear_scale": {
      const points = Math.floor((block.max - block.min) / block.step) + 1;
      // Skewed toward the upper half, like most satisfaction scales.
      const weights = Array.from({ length: points }, (_, index) => 1 + index * 1.4 - (index === points - 1 ? 1.5 : 0));
      return block.min + weightedIndex(rng, weights) * block.step;
    }
    case "rating": {
      const weights = Array.from({ length: block.maxRating }, (_, index) => (index < block.maxRating - 3 ? 0.3 : 1 + index));
      return weightedIndex(rng, weights) + 1;
    }
    case "number":
      return numberAnswer(block, rng);
    case "date": {
      const from = parsedDay(block.minDate, now - 60 * 86_400_000);
      const until = parsedDay(block.maxDate, now);
      return isoDay(from + rng() * Math.max(0, until - from));
    }
    case "text":
    case "textarea":
      if (block.type === "text" && block.pattern && !block.required) return null;
      return textAnswer(block.type === "text" ? SHORT_TEXTS : COMMENTS, rng, block.minLength, block.maxLength);
    default:
      // file_upload: no mock file to point at.
      return null;
  }
}

/**
 * Attention checks (Figma 13 "Câu kiểm tra"): respondents answer the expected
 * value; under FLAG about 1 in 12 misses it and is flagged for review. A miss
 * under DISQUALIFY never becomes a completion, so it is not generated.
 */
function attentionAnswer(block: FormBlock, rng: Rng, seed: string, now: number): { answer: MockAnswer; failed: boolean } | null {
  const check = block.integrity?.attentionCheck;
  if (!check?.isAttentionCheck) return null;
  if (check.failAction === "FLAG" && rng() < 0.08) {
    const answer = answerFor({ ...block, required: true } as FormBlock, rng, seed, now);
    if (JSON.stringify(answer) !== JSON.stringify(check.expectedValue)) return { answer, failed: true };
  }
  return { answer: check.expectedValue, failed: false };
}

export interface GenerateResponsesInput {
  seed: string;
  formId: string;
  versionNumber: number;
  blocks: FormBlock[];
  /** Rows to add and how many the survey already has (codes/ids stay unique). */
  count: number;
  startIndex: number;
  /** Collection window (ISO): rows are spread between these. */
  from: string;
  until: string;
  effortSeconds: number;
  takenCodes?: ReadonlySet<string>;
}

/** `count` responses to `blocks`, oldest first; ~1 in 8 flagged TOO_FAST, a few failing a FLAG attention check. */
export function generateResponses(input: GenerateResponsesInput): MockFormResponse[] {
  const rng = createRng(`${input.seed}:responses:${input.startIndex}`);
  const start = Date.parse(input.from);
  const end = Math.max(start, Date.parse(input.until));
  const effort = Math.max(60, input.effortSeconds);
  const taken = new Set(input.takenCodes ?? []);
  const times = Array.from({ length: input.count }, () => start + Math.pow(rng(), 0.8) * (end - start)).sort((a, b) => a - b);
  return times.map((time, offset) => {
    const index = input.startIndex + offset;
    let code = "";
    do code = Math.floor(rng() * 0xffff).toString(16).toUpperCase().padStart(4, "0");
    while (taken.has(code));
    taken.add(code);
    const tooFast = rng() < 0.125;
    const seconds = tooFast ? Math.round(effort * (0.2 + rng() * 0.15)) : Math.round(effort * (0.7 + rng() * 0.7));
    const reviewReasons: MockFormResponse["reviewReasons"] = [];
    if (tooFast) reviewReasons.push({ code: "TOO_FAST", params: { declaredMinutes: Math.max(1, Math.round(effort / 60)) } });
    const answers: Record<string, MockAnswer> = {};
    for (const block of input.blocks) {
      const attention = attentionAnswer(block, rng, input.seed, time);
      answers[block.id] = attention ? attention.answer : answerFor(block, rng, input.seed, time);
      if (attention?.failed) reviewReasons.push({ code: "ATTENTION_CHECK_FAILED", params: {} });
    }
    return {
      id: `5a1c7e90-${index.toString(16).padStart(4, "0")}-4d2e-8f3a-${hex12(input.seed)}`,
      formId: input.formId,
      versionNumber: input.versionNumber,
      code,
      submittedAt: new Date(time).toISOString(),
      durationSeconds: seconds,
      quality: reviewReasons.length ? "NEEDS_REVIEW" : "PASSED",
      reviewReasons,
      answers,
      codeVerified: null,
    };
  });
}

function hex12(seed: string): string {
  const rng = createRng(`${seed}:uuid`);
  return Array.from({ length: 12 }, () => Math.floor(rng() * 16).toString(16)).join("");
}

// --- Tracking (Figma 10a) ---

const HOUR_LABELS = ["0h", "3h", "6h", "9h", "12h", "15h", "18h", "21h"];
const WEEK_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const WEEKS_LABELS = ["Tuần 1", "Tuần 2", "Tuần 3", "Tuần 4"];
const MONTH_LABELS = ["T4", "T5", "T6", "T7", "T8", "T9"];
/** Students open surveys in the evening more than at dawn. */
const HOUR_WEIGHTS = [0.3, 0.1, 0.2, 1.1, 1.4, 1.2, 1.8, 2.2];

export interface GenerateTrackingInput {
  seed: string;
  completed: number;
  /** Durations of the survey's responses (average "Thời gian làm TB"). */
  durations: readonly number[];
  publishedAt: string;
  now: number;
}

function series(labels: readonly string[], counts: readonly number[]) {
  return labels.map((label, index) => ({ label, count: counts[index] ?? 0 }));
}

function feedbackOf(rng: Rng, completed: number): MockFormTracking["feedback"] {
  if (completed === 0) return { count: 0, averageRating: null, issues: [] };
  const count = Math.max(1, Math.round(completed * (0.5 + rng() * 0.25)));
  const stars = Array.from({ length: count }, () => weightedIndex(rng, [0.2, 0.4, 1.4, 3.5, 4.5]) + 1);
  const averageRating = Math.round((stars.reduce((sum, value) => sum + value, 0) / count) * 10) / 10;
  const share = (max: number) => Math.round((Math.floor(rng() * (count * max + 1)) / count) * 100);
  const issues: { tag: SurveyFeedbackIssueTag; percent: number }[] = [
    { tag: "LONGER_THAN_ESTIMATED", percent: share(0.35) },
    { tag: "UNCLEAR_QUESTIONS", percent: share(0.25) },
    { tag: "MISLEADING_DESCRIPTION", percent: share(0.1) },
    { tag: "TECHNICAL_ISSUE", percent: share(0.08) },
  ];
  return { count, averageRating, issues };
}

/** Opens chart, funnel, average duration and ratings consistent with `completed`. */
export function generateTracking(input: GenerateTrackingInput): MockFormTracking {
  const rng = createRng(`${input.seed}:tracking:${input.completed}`);
  const abandoned = input.completed === 0 ? between(rng, 0, 2) : Math.max(1, Math.round(input.completed * (0.12 + rng() * 0.1)));
  const started = input.completed + abandoned;
  const total = Math.max(started, Math.round(started * (1.8 + rng() * 0.8)) + between(rng, 1, 4));

  // "Ngày": the last days of this week since publishing (T2…CN, today included).
  const ageDays = Math.max(1, Math.ceil((input.now - Date.parse(input.publishedAt)) / 86_400_000));
  const today = (new Date(input.now).getDay() + 6) % 7;
  const dayWeights = WEEK_LABELS.map((_, index) => (index <= today && today - index < ageDays ? 0.6 + rng() : 0));
  if (!dayWeights.some((weight) => weight > 0)) dayWeights[today] = 1;
  const day = distribute(total, dayWeights);
  // "Giờ": today's opens by 3-hour slot, between publishing and now.
  const midnight = new Date(input.now);
  midnight.setHours(0, 0, 0, 0);
  const published = Date.parse(input.publishedAt);
  const slotOpen = (index: number) => {
    const start = midnight.getTime() + index * 3 * 3_600_000;
    return start <= input.now && start + 3 * 3_600_000 > published;
  };
  const hourWeights = HOUR_WEIGHTS.map((weight, index) => (slotOpen(index) ? weight * (0.6 + rng() * 0.8) : 0));
  if (!hourWeights.some((weight) => weight > 0)) hourWeights[Math.floor(new Date(input.now).getHours() / 3)] = 1;
  const hour = distribute(day[today], hourWeights);
  // "Tuần": the last weeks since publishing; "Tháng": this month (T9).
  const ageWeeks = Math.min(WEEKS_LABELS.length, Math.ceil(ageDays / 7));
  const week = distribute(total, WEEKS_LABELS.map((_, index) => (index >= WEEKS_LABELS.length - ageWeeks ? 1 + rng() : 0)));
  const month: number[] = MONTH_LABELS.map((_, index) => (index === MONTH_LABELS.length - 1 ? total : 0));
  const opens: Record<OpensRange, { label: string; count: number }[]> = {
    hour: series(HOUR_LABELS, hour),
    day: series(WEEK_LABELS, day),
    week: series(WEEKS_LABELS, week),
    month: series(MONTH_LABELS, month),
  };

  const durations = input.durations;
  return {
    opens,
    started,
    abandoned,
    averageDurationSeconds: durations.length
      ? Math.round(durations.reduce((sum, seconds) => sum + seconds, 0) / durations.length)
      : null,
    pendingAttempts: [],
    feedback: feedbackOf(rng, input.completed),
  };
}

// --- Quality snapshot (Figma 17) ---

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Where the abandoned respondents stopped: long-text questions lose the most. */
export function generateQualitySnapshot(input: {
  seed: string;
  formId: string;
  versionNumber: number;
  blocks: FormBlock[];
  tracking: MockFormTracking;
  responses: readonly MockFormResponse[];
}): MockQualitySnapshot {
  const rng = createRng(`${input.seed}:quality:${input.responses.length}`);
  const ordered = [...input.blocks].sort((a, b) => a.order - b.order);
  const weights = ordered.map((block, index) =>
    (block.type === "textarea" ? 3 : block.type === "multiple_choice" ? 1.6 : 0.7) * (1 + index / ordered.length) * (0.5 + rng()),
  );
  const drops = distribute(input.tracking.abandoned, weights);
  const dropOffByQuestion: Record<number, number> = {};
  drops.forEach((count, index) => {
    if (count > 0) dropOffByQuestion[index + 1] = count;
  });
  const choiceNumbers = ordered
    .map((block, index) => (block.type === "single_choice" || block.type === "multiple_choice" ? index + 1 : 0))
    .filter(Boolean);
  const newest = input.responses.reduce<string | null>(
    (latest, row) => (!latest || Date.parse(row.submittedAt) > Date.parse(latest) ? row.submittedAt : latest),
    null,
  );
  return {
    formId: input.formId,
    versionNumber: input.versionNumber,
    started: input.tracking.started,
    abandoned: input.tracking.abandoned,
    medianDurationSeconds: median(input.responses.map((row) => row.durationSeconds)),
    technicalErrors: rng() < 0.2 ? 1 : 0,
    feedback: { average: input.tracking.feedback.averageRating, count: input.tracking.feedback.count },
    dropOffByQuestion,
    answerChangesQuestion: choiceNumbers.length && rng() < 0.6 ? choiceNumbers[between(rng, 0, choiceNumbers.length - 1)] : null,
    updatedAt: newest ?? new Date().toISOString(),
  };
}
