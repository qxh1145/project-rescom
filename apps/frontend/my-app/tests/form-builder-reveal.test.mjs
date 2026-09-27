import assert from "node:assert/strict";
import test from "node:test";

const reveal = await import("../lib/forms/ai-reveal.ts");

test("visibleLength ignores the bold markers", () => {
  assert.equal(reveal.visibleLength("Mình soạn **12 câu** rồi."), "Mình soạn 12 câu rồi.".length);
  assert.equal(reveal.visibleLength(""), 0);
});

test("cutRuns cuts across bold runs by visible characters", () => {
  const text = "Có **12 câu** trong 3 phần";
  assert.deepEqual(reveal.cutRuns(text, 0), []);
  assert.deepEqual(reveal.cutRuns(text, 5), [
    { text: "Có ", bold: false },
    { text: "12", bold: true },
  ]);
  const all = reveal.cutRuns(text, 999);
  assert.equal(all.map((run) => run.text).join(""), "Có 12 câu trong 3 phần");
  assert.deepEqual(all[1], { text: "12 câu", bold: true });
});

test("revealSplit fills the pieces in order", () => {
  assert.deepEqual(reveal.revealSplit([5, 3, 4], 0), [0, 0, 0]);
  assert.deepEqual(reveal.revealSplit([5, 3, 4], 6), [5, 1, 0]);
  assert.deepEqual(reveal.revealSplit([5, 3, 4], 100), [5, 3, 4]);
  assert.deepEqual(reveal.revealSplit([5, 0, 4], Infinity), [5, 0, 4]);
});

test("revealedAt paces linearly and is capped for long answers", () => {
  const total = 140; // one second at REVEAL_CHARS_PER_SECOND
  assert.equal(reveal.revealDurationMs(total), 1000);
  assert.equal(reveal.revealedAt(0, total), 0);
  assert.equal(reveal.revealedAt(500, total), 70);
  assert.equal(reveal.revealedAt(1000, total), total);
  assert.equal(reveal.revealDurationMs(100_000), reveal.REVEAL_MAX_MS);
  assert.equal(reveal.revealedAt(reveal.REVEAL_MAX_MS, 100_000), 100_000);
  assert.equal(reveal.revealedAt(10, 0), 0);
});
