import type { FormAnalytics, QuestionAnalytics, QuestionSummary } from "@/lib/forms/results-analytics-service";
import type { ResultQuestion } from "@/lib/forms/results-service";
import type { MockAnswer, MockFormResponse } from "./form-responses";

/**
 * Pure aggregation behind `GET /forms/:id/analytics` (ASSUMED API CONTRACT,
 * `lib/forms/results-analytics-service.ts`). The backend is expected to
 * compute the same DTO, so this is the reference for it. No MSW, no storage —
 * unit-tested in `tests/forms-analytics.test.mjs`.
 *
 * - An empty answer (null, missing, "", []) is skipped, and so is an invalid
 *   numeric one: a rating / linear-scale answer counts only as an integer
 *   within [min, max], a number answer only as a finite JS number (the submit
 *   check `validateAnswersAgainstFormDefinition` never coerces, so a numeric
 *   string is invalid too). Skipped answers stay out of answeredCount,
 *   buckets, average and median.
 * - `percentage` = count / answeredCount × 100, one decimal; 0 when nobody answered.
 *   A multiple-choice question uses the same denominator, so it may add up to
 *   more than 100 (never normalised).
 * - A choice answer matches an option by `value` or `label` (seeded housing rows
 *   store labels, generated rows store values); anything else is a free "Khác"
 *   answer when the block `allowOther`s.
 */

type AnalyticsQuestion = Pick<ResultQuestion, "id" | "number" | "title" | "type" | "required" | "options" | "allowOther" | "scale">;

export interface BuildFormAnalyticsInput {
  form: FormAnalytics["form"];
  /** Output of `questionsOf(version.blocks)` (form order); [] for Google Forms surveys. */
  questions: readonly AnalyticsQuestion[];
  /** Responses of the version, newest first. */
  rows: readonly MockFormResponse[];
  /** Attempts started on the version (quality snapshot); null = unknown. */
  startedCount: number | null;
}

const SAMPLE_LIMIT = 5;
const MAX_NUMBER_BUCKETS = 8;
const NUMBER_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 });

function isEmpty(value: MockAnswer | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** count / total × 100, one decimal; 0 when total is 0. */
export function percentOf(count: number, total: number): number {
  return total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
}

/** A finite JS number (numbers are stored as numbers, never coerced from strings). */
function isFiniteNumber(value: MockAnswer | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function scaleRange(question: AnalyticsQuestion): { min: number; max: number | null } {
  return { min: question.scale?.min ?? 1, max: question.scale?.max ?? null };
}

/** Whether the answer counts for the question (see the rules above). */
function isCountedAnswer(question: AnalyticsQuestion, value: MockAnswer | undefined): value is MockAnswer {
  switch (question.type) {
    case "rating":
    case "linear_scale": {
      const { min, max } = scaleRange(question);
      return isFiniteNumber(value) && Number.isInteger(value) && value >= min && (max === null || value <= max);
    }
    case "number":
      return isFiniteNumber(value);
    default:
      return !isEmpty(value);
  }
}

function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Middle value; an even count takes the mean of the two middles. */
export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function choiceSummary(question: AnalyticsQuestion, answers: readonly MockAnswer[], answered: number): QuestionSummary {
  const counts = question.options.map(() => 0);
  let otherCount = 0;
  const samples: string[] = [];
  const indexOf = (text: string) =>
    question.options.findIndex((option) => option.value === text || option.label === text);

  for (const answer of answers) {
    const picks = (Array.isArray(answer) ? answer : [answer]).map((item) => String(item).trim()).filter(Boolean);
    const matched = new Set<number>();
    const others: string[] = [];
    for (const pick of picks) {
      const index = indexOf(pick);
      if (index >= 0) matched.add(index);
      else others.push(pick);
    }
    for (const index of matched) counts[index] += 1;
    if (question.allowOther && others.length) {
      otherCount += 1;
      for (const text of others) {
        if (samples.length < SAMPLE_LIMIT && !samples.includes(text)) samples.push(text);
      }
    }
  }

  return {
    kind: "choice",
    multiple: question.type === "multiple_choice",
    options: question.options.map((option, index) => ({
      value: option.value,
      label: option.label,
      count: counts[index],
      percentage: percentOf(counts[index], answered),
    })),
    other: question.allowOther ? { count: otherCount, percentage: percentOf(otherCount, answered), samples } : null,
  };
}

function scaleSummary(question: AnalyticsQuestion, values: readonly number[], answered: number): QuestionSummary {
  const range = scaleRange(question);
  const min = range.min;
  const max = range.max ?? Math.max(min, ...values);
  const buckets = [];
  for (let point = min; point <= max; point += 1) {
    const count = values.filter((value) => value === point).length;
    buckets.push({ value: point, count, percentage: percentOf(count, answered) });
  }
  return {
    kind: "scale",
    min,
    max,
    minLabel: question.scale?.minLabel ?? null,
    maxLabel: question.scale?.maxLabel ?? null,
    buckets,
    average: mean(values),
    median: median(values),
  };
}

/** Guards the bin arithmetic against binary rounding (0,3 / 0,1 = 2,999…). */
const BIN_EPSILON = 1e-9;

/** `step` × 10^`exponent`, divided for negative exponents so 0,2 stays the closest double to 0,2. */
function scaled(step: number, exponent: number): number {
  return exponent >= 0 ? step * 10 ** exponent : step / 10 ** -exponent;
}

/** Index of the aligned bin of `value` (bins start at multiples of `width`). */
function binIndex(value: number, width: number): number {
  return Math.floor(value / width + BIN_EPSILON);
}

/**
 * Smallest 1·2·5 × 10ⁿ width (n may be negative: 0,1 · 0,2 · 0,5…) that covers
 * min..max in at most 8 aligned bins; `exponent` = n.
 */
function niceWidth(min: number, max: number): { width: number; exponent: number } {
  // A width below span / 8 always needs more than 8 bins, so start just under it.
  let exponent = Math.floor(Math.log10((max - min) / MAX_NUMBER_BUCKETS));
  for (;;) {
    for (const step of [1, 2, 5]) {
      const width = scaled(step, exponent);
      if (binIndex(max, width) - binIndex(min, width) + 1 <= MAX_NUMBER_BUCKETS) return { width, exponent };
    }
    exponent += 1;
  }
}

/**
 * ≤ 8 distinct values → one bucket each; otherwise ≤ 8 equal-width bins,
 * ascending, empty bins kept. Integer answers on an integer width read
 * "0–49", "50–99"; otherwise bins are half-open: "0–<0,2", "0,2–<0,4".
 * A negative bound spaces the dash ("-20 – -11").
 */
export function numberBuckets(values: readonly number[], answered: number): Array<{ label: string; count: number; percentage: number }> {
  if (!values.length) return [];
  const distinct = [...new Set(values)].sort((a, b) => a - b);
  if (distinct.length <= MAX_NUMBER_BUCKETS) {
    return distinct.map((value) => {
      const count = values.filter((item) => item === value).length;
      return { label: NUMBER_FORMAT.format(value), count, percentage: percentOf(count, answered) };
    });
  }
  const min = distinct[0];
  const max = distinct[distinct.length - 1];
  const { width, exponent } = niceWidth(min, max);
  const first = binIndex(min, width);
  const binCount = binIndex(max, width) - first + 1;
  const closed = exponent >= 0 && values.every(Number.isInteger);
  const format = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: Math.max(0, -exponent) });
  const counts = new Array<number>(binCount).fill(0);
  for (const value of values) counts[Math.min(binCount - 1, Math.max(0, binIndex(value, width) - first))] += 1;
  return counts.map((count, index) => {
    const low = (first + index) * width;
    const high = closed ? low + width - 1 : low + width;
    const dash = low < 0 || high < 0 ? " – " : "–";
    return {
      label: `${format.format(low)}${dash}${closed ? "" : "<"}${format.format(high)}`,
      count,
      percentage: percentOf(count, answered),
    };
  });
}

function numberSummary(values: readonly number[], answered: number): QuestionSummary {
  return {
    kind: "number",
    average: mean(values),
    median: median(values),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    buckets: numberBuckets(values, answered),
  };
}

function textSummary(question: AnalyticsQuestion, rows: readonly MockFormResponse[]): QuestionSummary {
  const samples = [];
  for (const row of rows) {
    const value = row.answers[question.id];
    if (isEmpty(value)) continue;
    samples.push({
      responseId: row.id,
      value: Array.isArray(value) ? value.join(", ") : String(value).trim(),
      submittedAt: row.submittedAt,
    });
    if (samples.length === SAMPLE_LIMIT) break;
  }
  return { kind: "text", samples };
}

function questionAnalytics(question: AnalyticsQuestion, rows: readonly MockFormResponse[]): QuestionAnalytics {
  const answers = rows.map((row) => row.answers[question.id]).filter((value) => isCountedAnswer(question, value));
  const answered = answers.length;
  const numbers = answers.filter(isFiniteNumber);
  let summary: QuestionSummary;
  switch (question.type) {
    case "single_choice":
    case "multiple_choice":
      summary = choiceSummary(question, answers, answered);
      break;
    case "rating":
    case "linear_scale":
      summary = scaleSummary(question, numbers, answered);
      break;
    case "number":
      summary = numberSummary(numbers, answered);
      break;
    case "text":
    case "textarea":
    case "date":
      summary = textSummary(question, rows);
      break;
    case "file_upload":
      summary = { kind: "file" };
      break;
  }
  return {
    questionId: question.id,
    number: question.number,
    title: question.title,
    type: question.type,
    required: question.required,
    answeredCount: answered,
    skippedCount: rows.length - answered,
    summary,
  };
}

export function buildFormAnalytics({ form, questions, rows, startedCount }: BuildFormAnalyticsInput): FormAnalytics {
  const durations = rows.map((row) => row.durationSeconds);
  const averageDuration = mean(durations);
  const newest = rows.reduce<string | null>(
    (latest, row) => (latest === null || Date.parse(row.submittedAt) > Date.parse(latest) ? row.submittedAt : latest),
    null,
  );
  return {
    form: { id: form.id, title: form.title, type: form.type, versionNumber: form.versionNumber },
    totalResponses: rows.length,
    startedCount,
    averageDurationSeconds: averageDuration === null ? null : Math.round(averageDuration),
    lastResponseAt: newest,
    questions: questions.map((question) => questionAnalytics(question, rows)),
  };
}
