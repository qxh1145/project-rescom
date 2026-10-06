import test from "node:test";
import assert from "node:assert/strict";

const { buildFormAnalytics, numberBuckets, median, percentOf } = await import("../mocks/data/form-analytics.ts");
const seed = await import("../mocks/data/form-analytics-seed.ts");
const view = await import("../lib/forms/results-analytics.ts");
const { formAnalyticsSchema } = await import("../lib/forms/results-analytics-service.ts");
const { toPublisherQuestions } = await import("@rescom/schemas");

/** The mock aggregator is a thin wrapper of the shared `aggregateFormAnalytics` (Story IR.4a AC1.2). */
const FORM = { id: "f1", title: "Khảo sát thử", versionId: "v1", versionNumber: 1 };
const opts = (...labels) => labels.map((label, index) => ({ value: `opt_${index + 1}`, label }));

/** The shared question projection (backend and MSW use the same one). */
const questionsOf = (blocks) => toPublisherQuestions(blocks);

// --- Hand-made fixture: 6 rows, newest first ---

const QUESTIONS = [
  { id: "where", number: 1, title: "Chỗ ở", type: "single_choice", required: true, options: opts("Nhà trọ", "Ký túc xá", "Nhà riêng"), allowOther: true, scale: null },
  { id: "apps", number: 2, title: "Ứng dụng", type: "multiple_choice", required: true, options: opts("Facebook", "TikTok", "Zalo"), allowOther: false, scale: null },
  { id: "stars", number: 3, title: "Chấm sao", type: "rating", required: true, options: [], allowOther: false, scale: { min: 1, max: 5, minLabel: null, maxLabel: null } },
  { id: "scale", number: 4, title: "Thang 0–4", type: "linear_scale", required: false, options: [], allowOther: false, scale: { min: 0, max: 4, minLabel: "Thấp", maxLabel: "Cao" } },
  { id: "few", number: 5, title: "Số ít giá trị", type: "number", required: false, options: [], allowOther: false, scale: null },
  { id: "note", number: 6, title: "Ghi chú", type: "text", required: false, options: [], allowOther: false, scale: null },
  { id: "file", number: 7, title: "Tệp", type: "file_upload", required: false, options: [], allowOther: false, scale: null },
];

const ROW_ANSWERS = [
  // "Nhà trọ" by label (seeded housing rows store labels), the rest by value.
  { where: "Nhà trọ", apps: ["opt_1", "opt_2"], stars: 5, scale: 4, few: 1000, note: "Sáu", file: "a.pdf" },
  { where: "Ở với bạn", apps: ["opt_1", "opt_2", "opt_3"], stars: 4, scale: 4, few: 2, note: "Năm" },
  { where: "Ở với bạn", apps: ["opt_2"], stars: 4, scale: null, few: "", note: "   " },
  { where: "opt_2", apps: [], stars: 2, few: 2, note: "Bốn" },
  { where: "Căn hộ dịch vụ", apps: ["opt_1"], stars: 1, scale: 1, note: "Ba" },
  { where: "opt_2", apps: ["opt_1", "opt_1"], stars: 3, note: "Hai", extra: "ignored" },
];

const ROWS = ROW_ANSWERS.map((answers, index) => ({
  id: `r${index + 1}`,
  formId: FORM.id,
  versionNumber: 1,
  code: `C00${index}`,
  submittedAt: `2026-09-2${6 - index}T10:00:00+07:00`,
  durationSeconds: 100 + index * 10,
  quality: "PASSED",
  reviewReasons: [],
  answers,
  codeVerified: null,
}));

const FIXTURE = buildFormAnalytics({ form: FORM, questions: QUESTIONS, rows: ROWS });
const byId = (analytics, id) => analytics.questions.find((question) => question.questionId === id);

test("totals: count and newest submission; no funnel metrics (FR-41 deferred)", () => {
  assert.equal(FIXTURE.availability, "AVAILABLE");
  assert.equal(FIXTURE.totalResponses, 6);
  assert.equal(FIXTURE.lastResponseAt, "2026-09-26T10:00:00+07:00");
  assert.equal("startedCount" in FIXTURE, false);
  assert.equal("averageDurationSeconds" in FIXTURE, false);
  assert.deepEqual(FIXTURE.form, { ...FORM, type: "INTERNAL" });
  assert.equal(formAnalyticsSchema.parse(FIXTURE).questions.length, QUESTIONS.length);
});

test("single choice: matches value or label, free answers go to the Khác bucket (newest distinct samples)", () => {
  const where = byId(FIXTURE, "where");
  assert.equal(where.answeredCount, 6);
  assert.equal(where.skippedCount, 0);
  assert.deepEqual(
    where.summary.options.map((option) => [option.label, option.count, option.percentage]),
    [
      ["Nhà trọ", 1, 16.7],
      ["Ký túc xá", 2, 33.3],
      ["Nhà riêng", 0, 0],
    ],
  );
  assert.deepEqual(where.summary.other, { count: 3, percentage: 50, samples: ["Ở với bạn", "Căn hộ dịch vụ"] });
  assert.equal(where.summary.multiple, false);
});

test("multiple choice: per-respondent shares may exceed 100%, [] is skipped, a repeated pick counts once", () => {
  const apps = byId(FIXTURE, "apps");
  assert.equal(apps.answeredCount, 5);
  assert.equal(apps.skippedCount, 1);
  assert.equal(apps.summary.multiple, true);
  assert.deepEqual(apps.summary.options.map((option) => option.count), [4, 3, 1]);
  assert.deepEqual(apps.summary.options.map((option) => option.percentage), [80, 60, 20]);
  assert.ok(apps.summary.options.reduce((sum, option) => sum + option.percentage, 0) > 100);
  assert.equal(apps.summary.other, null);
});

test("rating: every point, average and median", () => {
  const stars = byId(FIXTURE, "stars");
  assert.deepEqual(stars.summary.buckets.map((bucket) => bucket.count), [1, 1, 1, 2, 1]);
  assert.equal(stars.summary.average, 19 / 6);
  assert.equal(stars.summary.median, 3.5);
  assert.equal(stars.summary.min, 1);
  assert.equal(stars.summary.max, 5);
});

test("linear scale: zero-count points are kept, labels passed through, null/missing skipped", () => {
  const scale = byId(FIXTURE, "scale");
  assert.equal(scale.answeredCount, 3);
  assert.equal(scale.skippedCount, 3);
  assert.deepEqual(
    scale.summary.buckets.map((bucket) => [bucket.value, bucket.count, bucket.percentage]),
    [
      [0, 0, 0],
      [1, 1, 33.3],
      [2, 0, 0],
      [3, 0, 0],
      [4, 2, 66.7],
    ],
  );
  assert.equal(scale.summary.minLabel, "Thấp");
  assert.equal(scale.summary.median, 4);
});

test("number: ≤ 8 distinct values → one vi-VN labelled bucket per value", () => {
  const few = byId(FIXTURE, "few");
  assert.equal(few.answeredCount, 3);
  assert.deepEqual(few.summary.buckets, [
    { label: "2", count: 2, percentage: 66.7 },
    { label: "1.000", count: 1, percentage: 33.3 },
  ]);
  assert.equal(few.summary.min, 2);
  assert.equal(few.summary.max, 1000);
  assert.equal(few.summary.median, 2);
});

test("number: > 8 distinct values → ≤ 8 nice integer bins, ascending, empty bins kept", () => {
  const values = [0, 10, 20, 30, 40, 499, 500, 1200, 3900, 3999];
  const buckets = numberBuckets(values, values.length);
  assert.ok(buckets.length <= 8);
  assert.deepEqual(buckets.map((bucket) => bucket.label), ["0–499", "500–999", "1.000–1.499", "1.500–1.999", "2.000–2.499", "2.500–2.999", "3.000–3.499", "3.500–3.999"]);
  assert.deepEqual(buckets.map((bucket) => bucket.count), [6, 1, 1, 0, 0, 0, 0, 2]);
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.count, 0), values.length);
  // Non-integer answers on an integer width: half-open bins.
  const decimals = numberBuckets([0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], 9);
  assert.ok(decimals.length <= 8);
  assert.equal(decimals[0].label, "0–<2");
});

test("number: decimals in a narrow range spread over decimal-width bins (0,3 lands in 0,3–<0,4)", () => {
  const values = [0.05, 0.11, 0.18, 0.2, 0.27, 0.3, 0.41, 0.5, 0.58, 0.62];
  const buckets = numberBuckets(values, values.length);
  assert.deepEqual(buckets.map((bucket) => bucket.label), ["0–<0,1", "0,1–<0,2", "0,2–<0,3", "0,3–<0,4", "0,4–<0,5", "0,5–<0,6", "0,6–<0,7"]);
  assert.deepEqual(buckets.map((bucket) => bucket.count), [1, 2, 2, 1, 1, 2, 1]);

  const tiny = [0.001, 0.002, 0.003, 0.004, 0.005, 0.006, 0.007, 0.008, 0.009];
  const tinyBuckets = numberBuckets(tiny, tiny.length);
  assert.ok(tinyBuckets.length > 1 && tinyBuckets.length <= 8);
  assert.equal(tinyBuckets[0].label, "0–<0,002");
  assert.equal(tinyBuckets.reduce((sum, bucket) => sum + bucket.count, 0), tiny.length);
});

test("number: negative answers get aligned bins with a spaced dash", () => {
  const values = [-15, -12, -7, -3, 0, 2, 5, 9, 12, 20];
  const buckets = numberBuckets(values, values.length);
  assert.deepEqual(buckets.map((bucket) => bucket.label), ["-15 – -11", "-10 – -6", "-5 – -1", "0–4", "5–9", "10–14", "15–19", "20–24"]);
  assert.deepEqual(buckets.map((bucket) => bucket.count), [2, 1, 1, 2, 2, 1, 0, 1]);
});

test("number: all-equal answers and a single answer → one bucket", () => {
  assert.deepEqual(numberBuckets([7, 7, 7], 3), [{ label: "7", count: 3, percentage: 100 }]);
  assert.deepEqual(numberBuckets([0.25], 1), [{ label: "0,25", count: 1, percentage: 100 }]);
});

test("invalid numeric answers are skipped: scale needs an integer in range, number a finite number", () => {
  const questions = [
    { id: "stars", number: 1, title: "Sao", type: "rating", required: false, options: [], allowOther: false, scale: { min: 1, max: 5, minLabel: null, maxLabel: null } },
    { id: "count", number: 2, title: "Số", type: "number", required: false, options: [], allowOther: false, scale: null },
  ];
  const answers = [
    { stars: 4, count: 3 },
    { stars: 6, count: "12" },
    { stars: 0, count: Number.NaN },
    { stars: 2.5, count: Number.POSITIVE_INFINITY },
    { stars: "5", count: -1.5 },
    { stars: 2 },
  ];
  const rows = answers.map((row, index) => ({ ...ROWS[0], id: `x${index}`, answers: row }));
  const result = buildFormAnalytics({ form: FORM, questions, rows });
  const stars = byId(result, "stars");
  assert.equal(stars.answeredCount, 2);
  assert.equal(stars.skippedCount, 4);
  assert.deepEqual(stars.summary.buckets.map((bucket) => bucket.count), [0, 1, 0, 1, 0]);
  assert.equal(stars.summary.buckets[1].percentage, 50);
  assert.equal(stars.summary.average, 3);
  assert.equal(stars.summary.median, 3);
  const count = byId(result, "count");
  assert.equal(count.answeredCount, 2);
  assert.equal(count.skippedCount, 4);
  assert.equal(count.summary.average, 0.75);
  assert.equal(count.summary.min, -1.5);
  assert.equal(count.summary.max, 3);
  formAnalyticsSchema.parse(result);
});

test("text: newest 5 non-empty answers; file: count only", () => {
  const note = byId(FIXTURE, "note");
  assert.equal(note.answeredCount, 5);
  assert.deepEqual(note.summary.samples.map((sample) => sample.value), ["Sáu", "Năm", "Bốn", "Ba", "Hai"]);
  assert.deepEqual(note.summary.samples[0], { responseId: "r1", value: "Sáu", submittedAt: "2026-09-26T10:00:00+07:00" });
  const file = byId(FIXTURE, "file");
  assert.deepEqual(file.summary, { kind: "file" });
  assert.equal(file.answeredCount, 1);
  assert.equal(file.skippedCount, 5);
});

test("no responses: zero percentages and null stats", () => {
  const empty = buildFormAnalytics({ form: FORM, questions: QUESTIONS, rows: [] });
  assert.equal(empty.totalResponses, 0);
  assert.equal(empty.lastResponseAt, null);
  assert.ok(byId(empty, "where").summary.options.every((option) => option.count === 0 && option.percentage === 0));
  assert.deepEqual(byId(empty, "where").summary.other, { count: 0, percentage: 0, samples: [] });
  const stars = byId(empty, "stars").summary;
  assert.equal(stars.average, null);
  assert.equal(stars.median, null);
  assert.deepEqual(byId(empty, "few").summary, { kind: "number", average: null, median: null, min: null, max: null, buckets: [] });
  assert.deepEqual(byId(empty, "note").summary.samples, []);
  formAnalyticsSchema.parse(empty);
});

test("percentOf / median helpers", () => {
  assert.equal(percentOf(126, 321), 39.3);
  assert.equal(percentOf(1, 0), 0);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

// --- Seed: "Đánh giá trải nghiệm nền tảng RESCOM" (321) and the empty survey ---

const NOW = Date.parse("2026-09-27T15:30:00+07:00");
const RX_ROWS = seed.analyticsResponses(NOW);
const RX_FORM = seed.analyticsPublisherForms(NOW)[0];
const RX = buildFormAnalytics({
  form: { id: RX_FORM.id, title: RX_FORM.title, versionId: "rx-v1", versionNumber: 1 },
  questions: questionsOf(seed.RESCOM_EXPERIENCE_BLOCKS),
  rows: [...RX_ROWS].sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt)),
});
const rxQuestion = (id) => byId(RX, id);

test("seed is deterministic and fits the collection window", () => {
  assert.deepEqual(seed.analyticsResponses(NOW), RX_ROWS);
  assert.equal(RX_ROWS.length, 321);
  assert.equal(new Set(RX_ROWS.map((row) => row.code)).size, 321);
  assert.ok(RX_ROWS.every((row) => /^[0-9A-F]{4}$/.test(row.code) && /\+07:00$/.test(row.submittedAt)));
  assert.ok(RX_ROWS.every((row) => row.durationSeconds >= 150 && row.durationSeconds <= 700));
  const review = RX_ROWS.filter((row) => row.quality === "NEEDS_REVIEW");
  assert.equal(review.length, 13);
  assert.ok(review.every((row) => row.reviewReasons[0].code === "TOO_FAST"));
  const published = Date.parse(RX_FORM.publishedAt);
  const closed = Date.parse(RX_FORM.closedAt);
  assert.ok(RX_ROWS.every((row) => Date.parse(row.submittedAt) > published && Date.parse(row.submittedAt) < closed));
  assert.equal(RX_FORM.completedCompletions, 321);
  assert.equal(RX_FORM.expectedCompletions, 321);
  assert.equal(RX_FORM.status, "CLOSED");
  assert.equal(RX_FORM.closeKind, "OWNER");
});

test("seed: exact counts and percentages of the RESCOM survey", () => {
  formAnalyticsSchema.parse(RX);
  assert.equal(RX.totalResponses, 321);
  const gender = rxQuestion("rx-gender").summary.options;
  assert.deepEqual(gender.map((option) => option.count), [126, 194, 1]);
  // 126/321 = 39,25… → 39,3 · 194/321 = 60,43… → 60,4 · 1/321 = 0,31… → 0,3
  assert.deepEqual(gender.map((option) => option.percentage), [39.3, 60.4, 0.3]);
  assert.deepEqual(rxQuestion("rx-age").summary.options.map((option) => option.count), [109, 76, 34, 48, 54]);
  assert.equal(rxQuestion("rx-age").summary.options[0].percentage, 34);

  const platforms = rxQuestion("rx-platforms");
  assert.equal(platforms.answeredCount, 321);
  assert.deepEqual(platforms.summary.options.map((option) => option.count), [245, 210, 145, 188, 132]);
  assert.equal(platforms.summary.other.count, 7);
  assert.equal(platforms.summary.other.samples.length, 5);
  assert.ok(platforms.summary.options.reduce((sum, option) => sum + option.percentage, 0) > 100);

  const stars = rxQuestion("rx-stars").summary;
  assert.deepEqual(stars.buckets.map((bucket) => bucket.count), [10, 15, 44, 103, 149]);
  assert.equal(Math.round(stars.average * 100) / 100, 4.14);
  assert.equal(stars.median, 4);

  const recommend = rxQuestion("rx-recommend").summary;
  assert.equal(recommend.buckets.length, 10);
  assert.equal(recommend.buckets.reduce((sum, bucket) => sum + bucket.count, 0), 321);

  assert.deepEqual(rxQuestion("rx-redeemed").summary.options.map((option) => option.count), [198, 123]);
  const channels = rxQuestion("rx-channel").summary.options;
  assert.equal(channels.length, 8);
  assert.equal(channels.reduce((sum, option) => sum + option.count, 0), 321);

  const minutes = rxQuestion("rx-minutes");
  assert.equal(minutes.answeredCount, 290);
  assert.ok(minutes.summary.buckets.length > 1 && minutes.summary.buckets.length <= 8);
  assert.ok(minutes.summary.min >= 0 && minutes.summary.max <= 300);

  assert.equal(rxQuestion("rx-like").answeredCount, 182);
  assert.equal(rxQuestion("rx-improve").answeredCount, 118);
  const since = rxQuestion("rx-since");
  assert.equal(since.answeredCount, 243);
  assert.ok(since.summary.samples.every((sample) => /^2026-\d{2}-\d{2}$/.test(sample.value)));
});

test("seed: the new survey has one version and no responses", () => {
  const [, groupStudy] = seed.analyticsPublisherForms(NOW);
  assert.equal(groupStudy.status, "PUBLISHED");
  assert.equal(groupStudy.completedCompletions, 0);
  assert.equal(groupStudy.expectedCompletions, 50);
  assert.ok(Date.parse(groupStudy.deadlineAt) > NOW);
  const versions = seed.analyticsFormVersions(NOW).filter((version) => version.formId === groupStudy.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].blocks.length, 5);
  assert.equal(RX_ROWS.filter((row) => row.formId === groupStudy.id).length, 0);
  const empty = buildFormAnalytics({ form: { id: groupStudy.id, title: groupStudy.title, versionId: versions[0].id, versionNumber: 1 }, questions: questionsOf(versions[0].blocks), rows: [] });
  assert.equal(formAnalyticsSchema.parse(empty).totalResponses, 0);
});

test("seed: the new survey is mirrored for respondents (same id, version, reward, effort)", () => {
  const [, groupStudy] = seed.analyticsPublisherForms(NOW);
  const [survey] = seed.analyticsRespondentSurveys(NOW);
  const [version] = seed.analyticsFormVersions(NOW).filter((item) => item.formId === groupStudy.id);
  assert.equal(survey.id, groupStudy.id);
  assert.equal(survey.formVersionId, version.id);
  assert.equal(survey.status, "PUBLISHED");
  assert.equal(survey.type, "INTERNAL");
  assert.equal(survey.title, groupStudy.title);
  assert.equal(survey.rewardPerResponse, groupStudy.rewardPerResponse);
  assert.equal(survey.expectedCompletions, groupStudy.expectedCompletions);
  assert.equal(survey.completedCompletions, 0);
  assert.equal(survey.estimatedEffortSeconds, groupStudy.estimatedEffortSeconds);
  assert.equal(survey.estimatedEffortSeconds, seed.GROUP_STUDY_EFFORT_SECONDS);
  assert.equal(survey.publishedAt, groupStudy.publishedAt);
});

test("seed: the quality snapshot median matches the generated durations", () => {
  // 321 rows (odd): the median is the 161st duration.
  const durations = RX_ROWS.map((row) => row.durationSeconds).sort((a, b) => a - b);
  assert.equal(seed.analyticsQualitySnapshots(NOW)[0].medianDurationSeconds, durations[160]);
});

// --- Presentation helpers (lib/forms/results-analytics.ts) ---

test("formatPercent / formatCount / formatStat use vi-VN with at most one decimal", () => {
  assert.equal(view.formatPercent(39.25), "39,3%");
  assert.equal(view.formatPercent(34), "34%");
  assert.equal(view.formatPercent(0.3), "0,3%");
  assert.equal(view.formatCount(1234), "1.234");
  assert.equal(view.formatStat(4.140186), "4,1");
  assert.equal(view.formatStat(null), "Chưa có");
  assert.equal(view.responsesLabel(321), "321 câu trả lời");
});

test("visualOf: single ≤ 5 slices → donut, 6+ → horizontal bars; Khác counts as a slice", () => {
  assert.equal(view.visualOf(rxQuestion("rx-gender")), "donut");
  assert.equal(view.visualOf(rxQuestion("rx-age")), "donut");
  assert.equal(view.visualOf(rxQuestion("rx-redeemed")), "donut");
  assert.equal(view.visualOf(rxQuestion("rx-channel")), "bar-horizontal");
  assert.equal(view.visualOf(rxQuestion("rx-platforms")), "bar-horizontal");
  assert.equal(view.visualOf(rxQuestion("rx-stars")), "bar-vertical");
  assert.equal(view.visualOf(rxQuestion("rx-recommend")), "bar-vertical");
  assert.equal(view.visualOf(rxQuestion("rx-minutes")), "bar-vertical");
  assert.equal(view.visualOf(rxQuestion("rx-like")), "text-list");
  assert.equal(view.visualOf(rxQuestion("rx-since")), "text-list");
  assert.equal(view.visualOf(byId(FIXTURE, "file")), "count-only");

  const fiveWithOther = {
    type: "single_choice",
    summary: {
      kind: "choice",
      multiple: false,
      options: opts("A", "B", "C", "D", "E").map((option) => ({ ...option, count: 1, percentage: 10 })),
      other: { count: 1, percentage: 10, samples: ["F"] },
    },
  };
  assert.equal(view.choiceSliceCount(fiveWithOther.summary), 6);
  assert.equal(view.visualOf(fiveWithOther), "bar-horizontal");
  assert.equal(view.visualOf({ ...fiveWithOther, summary: { ...fiveWithOther.summary, other: { count: 0, percentage: 0, samples: [] } } }), "donut");
});

test("free-answer bucket reads “Khác (tự nhập)” when a real option is labelled Khác", () => {
  const summary = (labels) => ({
    kind: "choice",
    multiple: false,
    options: opts(...labels).map((option) => ({ ...option, count: 1, percentage: 25 })),
    other: { count: 1, percentage: 25, samples: ["Tự nhập"] },
  });
  assert.equal(view.otherBucketLabel(summary(["A", "B"])), "Khác");
  assert.equal(view.otherBucketLabel(summary(["A", "  khác  "])), "Khác (tự nhập)");
  assert.equal(view.otherBucketLabel(summary(["A", "KHÁC"])), "Khác (tự nhập)");
  assert.equal(view.otherBucketLabel(summary(["A", "Khác nữa"])), "Khác");
  const rows = view.distributionRows({ type: "single_choice", summary: summary(["A", "Khác"]) });
  assert.equal(rows.at(-1).label, "Khác (tự nhập)");
  assert.equal(rows.at(-2).label, "Khác");
});

test("formatAnswerSample: dates read dd/mm/yyyy, other types unchanged", () => {
  assert.equal(view.formatAnswerSample("date", "2026-03-09"), "09/03/2026");
  assert.equal(view.formatAnswerSample("text", "2026-03-09"), "2026-03-09");
});

test("distributionRows: legend rows incl. the Khác bucket and star labels", () => {
  const rows = view.distributionRows(byId(FIXTURE, "where"));
  assert.deepEqual(rows.map((row) => row.label), ["Nhà trọ", "Ký túc xá", "Nhà riêng", "Khác"]);
  assert.equal(rows.at(-1).color, view.CHART_OTHER_COLOR);
  assert.equal(view.distributionRows(rxQuestion("rx-stars"))[4].label, "5 ★");
  assert.deepEqual(view.distributionRows(rxQuestion("rx-like")), []);
  assert.equal(view.sharesMayExceed100(rxQuestion("rx-platforms")), true);
});

test("headerMetrics: total and last response only (completion rate and average time are deferred, R4)", () => {
  assert.deepEqual(view.headerMetrics(RX), { totalResponses: 321, lastResponseAt: RX.lastResponseAt });
  assert.deepEqual(view.headerMetrics({ totalResponses: 0, lastResponseAt: null }), { totalResponses: 0, lastResponseAt: null });
});

test("resolveQuestionIndex clamps ?question= to an existing question", () => {
  const questions = RX.questions;
  assert.equal(view.resolveQuestionIndex(questions, "rx-stars"), 3);
  assert.equal(view.resolveQuestionIndex(questions, "nope"), 0);
  assert.equal(view.resolveQuestionIndex(questions, null), 0);
  assert.equal(view.resolveQuestionIndex([], "rx-stars"), -1);
});
