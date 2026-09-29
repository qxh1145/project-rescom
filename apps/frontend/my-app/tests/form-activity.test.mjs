import test from "node:test";
import assert from "node:assert/strict";

const rules = await import("../mocks/data/form-activity-rules.ts");

const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-27T15:30:00+07:00");

const BLOCKS = [
  { id: "freq", order: 0, type: "single_choice", title: "Tần suất", required: true, allowOther: false, options: ["Không", "1 lần", "2–3 lần"].map((label, i) => ({ id: `o${i}`, label, value: `opt_${i + 1}` })) },
  { id: "why", order: 1, type: "multiple_choice", title: "Mục đích", required: true, allowOther: false, options: ["Tự học", "Mượn sách", "Học nhóm", "Wi-Fi"].map((label, i) => ({ id: `p${i}`, label, value: `opt_${i + 1}` })) },
  { id: "quiet", order: 2, type: "linear_scale", title: "Yên tĩnh", required: true, min: 1, max: 5, step: 1 },
  { id: "stars", order: 3, type: "rating", title: "Chấm sao", required: true, maxRating: 5, ratingShape: "STAR" },
  { id: "budget", order: 4, type: "number", title: "Ngân sách", required: true, min: 0, max: 5000, integerOnly: true },
  { id: "wish", order: 5, type: "textarea", title: "Mong muốn", required: false },
];

function responses(count = 12) {
  return rules.generateResponses({
    seed: "form-1",
    formId: "form-1",
    versionNumber: 1,
    blocks: BLOCKS,
    count,
    startIndex: 0,
    from: new Date(NOW - 48 * HOUR).toISOString(),
    until: new Date(NOW).toISOString(),
    effortSeconds: 240,
  });
}

test("the same survey always gets the same responses", () => {
  assert.deepEqual(responses(), responses());
});

test("responses fit each block and the collection window", () => {
  const rows = responses(30);
  assert.equal(rows.length, 30);
  assert.equal(new Set(rows.map((row) => row.code)).size, 30);
  assert.equal(new Set(rows.map((row) => row.id)).size, 30);
  for (const row of rows) {
    const at = Date.parse(row.submittedAt);
    assert.ok(at >= NOW - 48 * HOUR && at <= NOW);
    assert.match(row.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(["opt_1", "opt_2", "opt_3"].includes(row.answers.freq));
    assert.ok(row.answers.why.length >= 1 && row.answers.why.every((value) => value.startsWith("opt_")));
    assert.ok(row.answers.quiet >= 1 && row.answers.quiet <= 5);
    assert.ok(Number.isInteger(row.answers.stars) && row.answers.stars >= 1 && row.answers.stars <= 5);
    assert.ok(Number.isInteger(row.answers.budget) && row.answers.budget >= 0 && row.answers.budget <= 5000);
    if (row.quality === "NEEDS_REVIEW") assert.equal(row.reviewReasons[0].code, "TOO_FAST");
  }
});

test("tracking is consistent with the completions", () => {
  const rows = responses(12);
  const tracking = rules.generateTracking({
    seed: "form-1",
    completed: 12,
    durations: rows.map((row) => row.durationSeconds),
    publishedAt: new Date(NOW - 50 * HOUR).toISOString(),
    now: NOW,
  });
  assert.equal(tracking.started, 12 + tracking.abandoned);
  assert.ok(tracking.abandoned >= 1);
  const total = (range) => tracking.opens[range].reduce((sum, bucket) => sum + bucket.count, 0);
  assert.ok(total("day") >= tracking.started);
  assert.equal(total("week"), total("day"));
  assert.equal(total("month"), total("day"));
  assert.ok(total("hour") <= total("day"));
  // Sunday 27/09: nothing opened on days before publishing (Friday 25/09 afternoon).
  assert.deepEqual(tracking.opens.day.slice(0, 4).map((bucket) => bucket.count), [0, 0, 0, 0]);
  assert.ok(tracking.feedback.count > 0 && tracking.feedback.count <= 12);
  assert.ok(tracking.feedback.averageRating >= 1 && tracking.feedback.averageRating <= 5);
  assert.equal(tracking.feedback.issues.length, 4);
  assert.ok(tracking.averageDurationSeconds > 0);
});

test("a survey without completions has no ratings", () => {
  const tracking = rules.generateTracking({ seed: "x", completed: 0, durations: [], publishedAt: new Date(NOW - HOUR).toISOString(), now: NOW });
  assert.equal(tracking.feedback.averageRating, null);
  assert.equal(tracking.averageDurationSeconds, null);
});

test("quality snapshot drop-off adds up to the abandoned count", () => {
  const rows = responses(12);
  const tracking = rules.generateTracking({ seed: "form-1", completed: 12, durations: rows.map((row) => row.durationSeconds), publishedAt: new Date(NOW - 50 * HOUR).toISOString(), now: NOW });
  const snapshot = rules.generateQualitySnapshot({ seed: "form-1", formId: "form-1", versionNumber: 1, blocks: BLOCKS, tracking, responses: rows });
  const drops = Object.values(snapshot.dropOffByQuestion).reduce((sum, count) => sum + count, 0);
  assert.equal(drops, tracking.abandoned);
  assert.ok(Object.keys(snapshot.dropOffByQuestion).every((number) => Number(number) >= 1 && Number(number) <= BLOCKS.length));
  assert.equal(snapshot.feedback.count, tracking.feedback.count);
});

test("distribute keeps the total", () => {
  assert.deepEqual(rules.distribute(10, [1, 1, 1]).reduce((a, b) => a + b, 0), 10);
  assert.deepEqual(rules.distribute(5, [0, 0]), [0, 0]);
});

test("answers respect selection, number and length bounds", () => {
  const rng = rules.createRng("bounds");
  const pick = { id: "pick", order: 0, type: "multiple_choice", title: "Chọn", required: true, allowOther: false, maxSelections: 1, options: BLOCKS[1].options };
  const steps = { id: "steps", order: 1, type: "number", title: "Số", required: true, max: -5, step: 5, integerOnly: true };
  const long = { id: "long", order: 2, type: "text", title: "Chữ", required: true, minLength: 30, maxLength: 40 };
  for (let index = 0; index < 50; index += 1) {
    assert.equal(rules.answerFor(pick, rng, "bounds").length, 1);
    const number = rules.answerFor(steps, rng, "bounds");
    assert.ok(number <= -5 && number % 5 === 0);
    const text = rules.answerFor(long, rng, "bounds");
    assert.ok(text.length >= 30 && text.length <= 40);
  }
});

test("attention checks get the expected answer unless a FLAG miss is flagged", () => {
  const check = (failAction) => ({
    ...BLOCKS[0],
    id: "check",
    integrity: { attentionCheck: { isAttentionCheck: true, expectedValue: "opt_2", failAction } },
  });
  const rows = (failAction) =>
    rules.generateResponses({ seed: `att-${failAction}`, formId: "f", versionNumber: 1, blocks: [check(failAction)], count: 200, startIndex: 0, from: new Date(NOW - HOUR).toISOString(), until: new Date(NOW).toISOString(), effortSeconds: 120 });
  assert.ok(rows("DISQUALIFY").every((row) => row.answers.check === "opt_2"));
  const flagged = rows("FLAG");
  const misses = flagged.filter((row) => row.answers.check !== "opt_2");
  assert.ok(misses.length > 0 && misses.length < 40);
  for (const row of misses) {
    assert.equal(row.quality, "NEEDS_REVIEW");
    assert.ok(row.reviewReasons.some((reason) => reason.code === "ATTENTION_CHECK_FAILED"));
  }
});
