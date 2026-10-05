import {
  aggregateFormAnalytics,
  analyticsMedian,
  analyticsNumberBuckets,
  analyticsPercentOf,
  type AnalyticsQuestion,
  type AnalyticsRow,
} from "./form-analytics.aggregate";
import { questionAnalyticsSchema, type QuestionAnalytics } from "./publisher-results.schema";

/** Ported from apps/frontend/my-app/tests/forms-analytics.test.mjs (the reference cases). */

const opts = (...labels: string[]) => labels.map((label, index) => ({ value: `opt_${index + 1}`, label }));
const noScale = { options: [], allowOther: false, scale: null };

const QUESTIONS: AnalyticsQuestion[] = [
  { id: "where", number: 1, title: "Chỗ ở", type: "single_choice", required: true, options: opts("Nhà trọ", "Ký túc xá", "Nhà riêng"), allowOther: true, scale: null },
  { id: "apps", number: 2, title: "Ứng dụng", type: "multiple_choice", required: true, options: opts("Facebook", "TikTok", "Zalo"), allowOther: false, scale: null },
  { id: "stars", number: 3, title: "Chấm sao", type: "rating", required: true, options: [], allowOther: false, scale: { min: 1, max: 5, minLabel: null, maxLabel: null } },
  { id: "scale", number: 4, title: "Thang 0–4", type: "linear_scale", required: false, options: [], allowOther: false, scale: { min: 0, max: 4, minLabel: "Thấp", maxLabel: "Cao" } },
  { id: "few", number: 5, title: "Số ít giá trị", type: "number", required: false, ...noScale },
  { id: "note", number: 6, title: "Ghi chú", type: "text", required: false, ...noScale },
  { id: "file", number: 7, title: "Tệp", type: "file_upload", required: false, ...noScale },
];

const ROW_ANSWERS: AnalyticsRow["answers"][] = [
  { where: "Nhà trọ", apps: ["opt_1", "opt_2"], stars: 5, scale: 4, few: 1000, note: "Sáu", file: ["a.pdf"] },
  { where: "Ở với bạn", apps: ["opt_1", "opt_2", "opt_3"], stars: 4, scale: 4, few: 2, note: "Năm" },
  { where: "Ở với bạn", apps: ["opt_2"], stars: 4, scale: null, few: "", note: "   " },
  { where: "opt_2", apps: [], stars: 2, few: 2, note: "Bốn" },
  { where: "Căn hộ dịch vụ", apps: ["opt_1"], stars: 1, scale: 1, note: "Ba" },
  { where: "opt_2", apps: ["opt_1", "opt_1"], stars: 3, note: "Hai", extra: "ignored" },
];

const ROWS: AnalyticsRow[] = ROW_ANSWERS.map((answers, index) => ({
  id: `r${index + 1}`,
  submittedAt: `2026-09-2${6 - index}T10:00:00+07:00`,
  answers,
}));

const FIXTURE = aggregateFormAnalytics(QUESTIONS, ROWS);
const byId = (questions: QuestionAnalytics[], id: string): QuestionAnalytics => {
  const found = questions.find((question) => question.questionId === id);
  if (!found) throw new Error(id);
  return found;
};
const summaryOf = <K extends QuestionAnalytics["summary"]["kind"]>(question: QuestionAnalytics, kind: K) => {
  if (question.summary.kind !== kind) throw new Error(`${question.questionId} is ${question.summary.kind}`);
  return question.summary as Extract<QuestionAnalytics["summary"], { kind: K }>;
};

describe("aggregateFormAnalytics", () => {
  it("totals and every question parse with the shared schema", () => {
    expect(FIXTURE.totalResponses).toBe(6);
    expect(FIXTURE.lastResponseAt).toBe("2026-09-26T10:00:00+07:00");
    for (const question of FIXTURE.questions) questionAnalyticsSchema.parse(question);
  });

  it("single choice matches value or label; free answers go to Khác (≤ 5 distinct samples)", () => {
    const where = byId(FIXTURE.questions, "where");
    expect([where.answeredCount, where.skippedCount]).toEqual([6, 0]);
    const summary = summaryOf(where, "choice");
    expect(summary.options.map((option) => [option.label, option.count, option.percentage])).toEqual([
      ["Nhà trọ", 1, 16.7],
      ["Ký túc xá", 2, 33.3],
      ["Nhà riêng", 0, 0],
    ]);
    expect(summary.other).toEqual({ count: 3, percentage: 50, samples: ["Ở với bạn", "Căn hộ dịch vụ"] });
    expect(summary.multiple).toBe(false);
  });

  it("multiple choice may exceed 100%, [] is skipped, a repeated pick counts once", () => {
    const apps = byId(FIXTURE.questions, "apps");
    expect([apps.answeredCount, apps.skippedCount]).toEqual([5, 1]);
    const summary = summaryOf(apps, "choice");
    expect(summary.options.map((option) => option.count)).toEqual([4, 3, 1]);
    expect(summary.options.map((option) => option.percentage)).toEqual([80, 60, 20]);
    expect(summary.other).toBeNull();
  });

  it("rating and linear scale keep every point; null/missing skipped", () => {
    const stars = summaryOf(byId(FIXTURE.questions, "stars"), "scale");
    expect(stars.buckets.map((bucket) => bucket.count)).toEqual([1, 1, 1, 2, 1]);
    expect(stars.average).toBe(19 / 6);
    expect(stars.median).toBe(3.5);
    const scaleQuestion = byId(FIXTURE.questions, "scale");
    expect([scaleQuestion.answeredCount, scaleQuestion.skippedCount]).toEqual([3, 3]);
    expect(summaryOf(scaleQuestion, "scale").buckets.map((bucket) => [bucket.value, bucket.count, bucket.percentage])).toEqual([
      [0, 0, 0],
      [1, 1, 33.3],
      [2, 0, 0],
      [3, 0, 0],
      [4, 2, 66.7],
    ]);
  });

  it("number with ≤ 8 distinct values → one vi-VN bucket per value", () => {
    const few = byId(FIXTURE.questions, "few");
    expect(few.answeredCount).toBe(3);
    expect(summaryOf(few, "number").buckets).toEqual([
      { label: "2", count: 2, percentage: 66.7 },
      { label: "1.000", count: 1, percentage: 33.3 },
    ]);
  });

  it("text: newest 5 non-empty answers; file: count only", () => {
    const note = byId(FIXTURE.questions, "note");
    expect(note.answeredCount).toBe(5);
    expect(summaryOf(note, "text").samples.map((sample) => sample.value)).toEqual(["Sáu", "Năm", "Bốn", "Ba", "Hai"]);
    const file = byId(FIXTURE.questions, "file");
    expect(file.summary).toEqual({ kind: "file" });
    expect([file.answeredCount, file.skippedCount]).toEqual([1, 5]);
  });

  it("skips invalid numeric answers (no coercion)", () => {
    const questions: AnalyticsQuestion[] = [
      { id: "stars", number: 1, title: "Sao", type: "rating", required: false, options: [], allowOther: false, scale: { min: 1, max: 5, minLabel: null, maxLabel: null } },
      { id: "count", number: 2, title: "Số", type: "number", required: false, ...noScale },
    ];
    const answers: AnalyticsRow["answers"][] = [
      { stars: 4, count: 3 },
      { stars: 6, count: "12" },
      { stars: 0, count: Number.NaN },
      { stars: 2.5, count: Number.POSITIVE_INFINITY },
      { stars: "5", count: -1.5 },
      { stars: 2 },
    ];
    const result = aggregateFormAnalytics(
      questions,
      answers.map((row, index) => ({ id: `x${index}`, submittedAt: ROWS[0].submittedAt, answers: row })),
    );
    const stars = byId(result.questions, "stars");
    expect([stars.answeredCount, stars.skippedCount]).toEqual([2, 4]);
    expect(summaryOf(stars, "scale").average).toBe(3);
    const count = summaryOf(byId(result.questions, "count"), "number");
    expect([count.average, count.min, count.max]).toEqual([0.75, -1.5, 3]);
  });

  it("no responses: zero percentages and null stats", () => {
    const empty = aggregateFormAnalytics(QUESTIONS, []);
    expect(empty).toMatchObject({ totalResponses: 0, lastResponseAt: null });
    expect(summaryOf(byId(empty.questions, "where"), "choice").other).toEqual({ count: 0, percentage: 0, samples: [] });
    expect(byId(empty.questions, "few").summary).toEqual({ kind: "number", average: null, median: null, min: null, max: null, buckets: [] });
  });
});

describe("analyticsNumberBuckets", () => {
  it("> 8 distinct integers → ≤ 8 nice closed bins, empty bins kept", () => {
    const values = [0, 10, 20, 30, 40, 499, 500, 1200, 3900, 3999];
    const buckets = analyticsNumberBuckets(values, values.length);
    expect(buckets.map((bucket) => bucket.label)).toEqual(["0–499", "500–999", "1.000–1.499", "1.500–1.999", "2.000–2.499", "2.500–2.999", "3.000–3.499", "3.500–3.999"]);
    expect(buckets.map((bucket) => bucket.count)).toEqual([6, 1, 1, 0, 0, 0, 0, 2]);
    expect(analyticsNumberBuckets([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], 9)[0].label).toBe("0–<2");
  });

  it("decimals spread over decimal-width bins", () => {
    const values = [0.05, 0.11, 0.18, 0.2, 0.27, 0.3, 0.41, 0.5, 0.58, 0.62];
    const buckets = analyticsNumberBuckets(values, values.length);
    expect(buckets.map((bucket) => bucket.label)).toEqual(["0–<0,1", "0,1–<0,2", "0,2–<0,3", "0,3–<0,4", "0,4–<0,5", "0,5–<0,6", "0,6–<0,7"]);
    expect(buckets.map((bucket) => bucket.count)).toEqual([1, 2, 2, 1, 1, 2, 1]);
    const tiny = [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009];
    expect(analyticsNumberBuckets(tiny, tiny.length)[0].label).toBe("0–<0,002");
  });

  it("negative bounds space the dash; equal values collapse to one bucket", () => {
    const values = [-15, -12, -7, -3, 0, 2, 5, 9, 12, 20];
    expect(analyticsNumberBuckets(values, values.length).map((bucket) => bucket.label)).toEqual(["-15 – -11", "-10 – -6", "-5 – -1", "0–4", "5–9", "10–14", "15–19", "20–24"]);
    expect(analyticsNumberBuckets([7, 7, 7], 3)).toEqual([{ label: "7", count: 3, percentage: 100 }]);
    expect(analyticsNumberBuckets([0.25], 1)).toEqual([{ label: "0,25", count: 1, percentage: 100 }]);
  });
});

describe("percent / median helpers", () => {
  it("rounds to one decimal and handles empty input", () => {
    expect(analyticsPercentOf(126, 321)).toBe(39.3);
    expect(analyticsPercentOf(1, 0)).toBe(0);
    expect(analyticsMedian([3, 1, 2])).toBe(2);
    expect(analyticsMedian([4, 1, 3, 2])).toBe(2.5);
    expect(analyticsMedian([])).toBeNull();
  });
});
