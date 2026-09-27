import assert from "node:assert/strict";
import test from "node:test";
import {
  createTelemetryQueue,
  enqueueEvent,
  drainBatch,
  formatTelemetryPayload,
  requeueBatch,
  classifyTelemetryResponse,
  resolveTelemetryUrl,
  uuidV4FromBytes,
  createClientEventId,
  answerEventTypeFor,
  answerCommitModeFor,
  isTextEntryElement,
  isAnswerValuePresent,
  createAnswerCommitDebouncer,
  createFocusTransitionTracker,
  createQuestionTelemetryController,
  markQuestionShown,
  ANSWER_COMMIT_IDLE_MS,
  FOCUS_BLUR_GRACE_MS,
  TELEMETRY_QUEUE_MAX,
} from "../app/forms/hooks/telemetry-buffer.mjs";

// Matches zod's `z.string().uuid()` shape (RFC 4122 v4 here).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    schedule(callback, ms) {
      const id = nextId++;
      timers.set(id, { callback, at: now + ms });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        timer.callback();
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

test("enqueues events up to max capacity without throwing", () => {
  const queue = createTelemetryQueue(3);
  enqueueEvent(queue, { clientEventId: "1", eventType: "QUESTION_SHOWN" }, 3);
  enqueueEvent(queue, { clientEventId: "2", eventType: "QUESTION_FOCUSED" }, 3);
  enqueueEvent(queue, { clientEventId: "3", eventType: "ANSWER_SELECTED" }, 3);
  // Exceeds max capacity - should drop oldest or reject to prevent memory leak
  enqueueEvent(queue, { clientEventId: "4", eventType: "ANSWER_CHANGED" }, 3);

  assert.equal(queue.length, 3);
  assert.equal(queue[0].clientEventId, "2");
  assert.equal(queue[2].clientEventId, "4");
});

test("drains batches safely up to batch size", () => {
  const queue = createTelemetryQueue(10);
  for (let i = 1; i <= 5; i++) {
    enqueueEvent(queue, { clientEventId: String(i), eventType: "QUESTION_SHOWN" }, 10);
  }

  const batch = drainBatch(queue, 3);
  assert.equal(batch.length, 3);
  assert.equal(batch[0].clientEventId, "1");
  assert.equal(queue.length, 2);
  assert.equal(queue[0].clientEventId, "4");
});

test("formats telemetry payload correctly with consent version", () => {
  const events = [
    { clientEventId: "1", eventType: "QUESTION_SHOWN" },
  ];
  const payload = formatTelemetryPayload(events, "v1.0");

  assert.deepEqual(payload, {
    events,
    consentNoticeVersion: "v1.0",
  });
});

// --- Epic 5 review P15 ------------------------------------------------------

test("requeues a failed batch at the front, preserving order", () => {
  const queue = [{ clientEventId: "c" }, { clientEventId: "d" }];
  requeueBatch(queue, [{ clientEventId: "a" }, { clientEventId: "b" }], 100);
  assert.deepEqual(
    queue.map((event) => event.clientEventId),
    ["a", "b", "c", "d"],
  );
});

test("requeue is bounded to the max size by dropping the oldest events", () => {
  const queue = [];
  for (let i = 0; i < TELEMETRY_QUEUE_MAX; i++) queue.push({ clientEventId: `new-${i}` });
  const batch = Array.from({ length: 25 }, (_, i) => ({ clientEventId: `old-${i}` }));

  requeueBatch(queue, batch, TELEMETRY_QUEUE_MAX);

  assert.equal(queue.length, 100);
  assert.equal(queue[0].clientEventId, "new-0");
  assert.equal(queue[99].clientEventId, "new-99");

  const small = [{ clientEventId: "x" }];
  requeueBatch(small, [{ clientEventId: "1" }, { clientEventId: "2" }, { clientEventId: "3" }], 3);
  assert.deepEqual(small.map((event) => event.clientEventId), ["2", "3", "x"]);
});

test("classifies telemetry responses: retry network/5xx/429, drop other 4xx", () => {
  assert.equal(classifyTelemetryResponse(200), "ok");
  assert.equal(classifyTelemetryResponse(202), "ok");
  assert.equal(classifyTelemetryResponse(undefined), "retry");
  assert.equal(classifyTelemetryResponse(null), "retry");
  assert.equal(classifyTelemetryResponse(500), "retry");
  assert.equal(classifyTelemetryResponse(503), "retry");
  assert.equal(classifyTelemetryResponse(429), "retry");
  assert.equal(classifyTelemetryResponse(400), "drop");
  assert.equal(classifyTelemetryResponse(403), "drop");
  assert.equal(classifyTelemetryResponse(404), "drop");
});

test("resolves the telemetry URL, preferring the response route", () => {
  assert.equal(
    resolveTelemetryUrl({ responseId: "r1", formId: "f1", attemptId: "a1" }),
    "/api/responses/r1/integrity-events",
  );
  assert.equal(
    resolveTelemetryUrl({ responseId: null, formId: "f1", attemptId: "a1" }),
    "/api/forms/f1/attempts/a1/integrity-events",
  );
  assert.equal(resolveTelemetryUrl({ attemptId: "a1" }), null);
});

test("builds UUID v4 client event ids from getRandomValues when randomUUID is missing", () => {
  assert.match(uuidV4FromBytes(new Uint8Array(16).fill(0xff)), UUID_V4);
  assert.equal(
    uuidV4FromBytes(new Uint8Array(16)),
    "00000000-0000-4000-8000-000000000000",
  );

  let filled = 0;
  const insecureContextCrypto = {
    getRandomValues(bytes) {
      filled += 1;
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) & 0xff;
      return bytes;
    },
  };
  const id = createClientEventId(insecureContextCrypto);
  assert.equal(filled, 1);
  assert.match(id, UUID_V4);

  assert.equal(createClientEventId({ randomUUID: () => "native-uuid" }), "native-uuid");
  assert.match(createClientEventId({}), UUID_V4);
  assert.match(createClientEventId(), UUID_V4);
});

// --- Epic 5 review P13 ------------------------------------------------------

test("maps block types to answer event types from the backend enum", () => {
  for (const type of ["single_choice", "multiple_choice", "rating", "linear_scale", "date"]) {
    assert.equal(answerEventTypeFor(type), "ANSWER_SELECTED", type);
  }
  for (const type of ["text", "textarea", "number"]) {
    assert.equal(answerEventTypeFor(type), "ANSWER_CHANGED", type);
  }
  assert.equal(answerEventTypeFor("file_upload"), "ANSWER_CHANGED");
  assert.equal(answerEventTypeFor("unknown"), null);
});

test("typed answers are deferred; selections are immediate unless typing", () => {
  assert.equal(answerCommitModeFor("text"), "deferred");
  assert.equal(answerCommitModeFor("textarea"), "deferred");
  assert.equal(answerCommitModeFor("number"), "deferred");
  assert.equal(answerCommitModeFor("single_choice"), "immediate");
  assert.equal(answerCommitModeFor("rating"), "immediate");
  assert.equal(answerCommitModeFor("single_choice", { typing: true }), "deferred");
});

test("detects text-entry elements", () => {
  assert.equal(isTextEntryElement({ tagName: "TEXTAREA" }), true);
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "text" }), true);
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "number" }), true);
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "radio" }), false);
  assert.equal(isTextEntryElement({ tagName: "INPUT", type: "date" }), false);
  assert.equal(isTextEntryElement({ tagName: "BUTTON" }), false);
  assert.equal(isTextEntryElement(null), false);
});

test("valuePresent treats empty strings and empty arrays as absent", () => {
  assert.equal(isAnswerValuePresent(""), false);
  assert.equal(isAnswerValuePresent(null), false);
  assert.equal(isAnswerValuePresent(undefined), false);
  assert.equal(isAnswerValuePresent([]), false);
  assert.equal(isAnswerValuePresent(["a"]), true);
  assert.equal(isAnswerValuePresent(0), true);
  assert.equal(isAnswerValuePresent("x"), true);
});

test("commit debouncer emits only the latest change after the idle period", () => {
  const clock = createFakeClock();
  const emitted = [];
  const debouncer = createAnswerCommitDebouncer({
    emit: (questionId, event) => emitted.push({ questionId, ...event }),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  // 20 keystrokes, 100 ms apart: nothing is emitted while typing.
  for (let i = 0; i < 20; i++) {
    debouncer.change("q1", { eventType: "ANSWER_CHANGED", valuePresent: true });
    clock.advance(100);
  }
  assert.equal(emitted.length, 0);

  clock.advance(ANSWER_COMMIT_IDLE_MS);
  assert.deepEqual(emitted, [
    { questionId: "q1", eventType: "ANSWER_CHANGED", valuePresent: true },
  ]);
  assert.equal(clock.pending, 0);
});

test("commit debouncer flushes on blur and discards cancelled changes", () => {
  const clock = createFakeClock();
  const emitted = [];
  const debouncer = createAnswerCommitDebouncer({
    emit: (questionId, event) => emitted.push({ questionId, ...event }),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  debouncer.change("q1", { eventType: "ANSWER_CHANGED", valuePresent: false });
  assert.equal(debouncer.flush("q1"), true);
  assert.equal(debouncer.flush("q1"), false);
  clock.advance(ANSWER_COMMIT_IDLE_MS * 2);
  assert.equal(emitted.length, 1);

  debouncer.change("q2", { eventType: "ANSWER_CHANGED", valuePresent: true });
  debouncer.discard("q2");
  debouncer.change("q3", { eventType: "ANSWER_CHANGED", valuePresent: true });
  debouncer.dispose();
  clock.advance(ANSWER_COMMIT_IDLE_MS * 2);
  assert.equal(emitted.length, 1);
});

test("focus tracker emits transitions only, not moves within a question", () => {
  const tracker = createFocusTransitionTracker();

  assert.deepEqual(tracker.focus("q1"), [{ eventType: "QUESTION_FOCUSED", questionId: "q1" }]);
  // Tab between two inputs of q1: blur stays inside, focus is the same question.
  assert.deepEqual(tracker.blur("q1", { stayingInside: true }), []);
  assert.deepEqual(tracker.focus("q1"), []);

  // Move to q2: blur is held, then committed by the next focus.
  assert.deepEqual(tracker.blur("q1"), []);
  assert.deepEqual(tracker.focus("q2"), [
    { eventType: "QUESTION_BLURRED", questionId: "q1" },
    { eventType: "QUESTION_FOCUSED", questionId: "q2" },
  ]);

  // Blur to nowhere and focus back (label click): nothing emitted.
  assert.deepEqual(tracker.blur("q2"), []);
  assert.deepEqual(tracker.focus("q2"), []);

  // Blur to nowhere, settled after the grace period.
  assert.deepEqual(tracker.blur("q2"), []);
  assert.deepEqual(tracker.settle(), [{ eventType: "QUESTION_BLURRED", questionId: "q2" }]);
  assert.deepEqual(tracker.settle(), []);
  assert.equal(tracker.current, null);
});

test("question telemetry controller: no per-keystroke events, focus transitions only", () => {
  const clock = createFakeClock();
  const events = [];
  const controller = createQuestionTelemetryController({
    emit: (eventType, questionId, metadata) => events.push({ eventType, questionId, metadata }),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  controller.questionFocused("q-text");
  for (const value of ["h", "he", "hel", "hell", "hello"]) {
    controller.answerChanged("q-text", "text", value, { typing: true });
    clock.advance(50);
  }
  assert.deepEqual(events.map((event) => event.eventType), ["QUESTION_FOCUSED"]);

  // Blur commits the typed answer, then the blur settles.
  controller.questionBlurred("q-text");
  clock.advance(FOCUS_BLUR_GRACE_MS);
  assert.deepEqual(events.slice(1), [
    { eventType: "ANSWER_CHANGED", questionId: "q-text", metadata: { valuePresent: true } },
    { eventType: "QUESTION_BLURRED", questionId: "q-text", metadata: undefined },
  ]);

  // Choice selection is immediate; a label click's repeated onChange is recorded once.
  events.length = 0;
  controller.questionFocused("q-choice");
  controller.answerChanged("q-choice", "single_choice", "opt-a");
  controller.answerChanged("q-choice", "single_choice", "opt-a");
  controller.answerChanged("q-choice", "single_choice", "opt-a");
  controller.questionBlurred("q-choice", { stayingInside: true });
  controller.questionFocused("q-choice");
  controller.answerChanged("q-choice", "single_choice", "opt-b");
  assert.deepEqual(events, [
    { eventType: "QUESTION_FOCUSED", questionId: "q-choice", metadata: undefined },
    { eventType: "ANSWER_SELECTED", questionId: "q-choice", metadata: { valuePresent: true } },
    { eventType: "ANSWER_SELECTED", questionId: "q-choice", metadata: { valuePresent: true } },
  ]);

  // Metadata never carries the answer value.
  for (const event of events) {
    assert.ok(!event.metadata || Object.keys(event.metadata).join() === "valuePresent");
  }

  controller.dispose();
  assert.equal(clock.pending, 0);
});

test("question telemetry controller commits typed answers after 1.5 s idle and on submit", () => {
  const clock = createFakeClock();
  const events = [];
  const controller = createQuestionTelemetryController({
    emit: (eventType, questionId, metadata) => events.push({ eventType, questionId, metadata }),
    schedule: clock.schedule,
    cancel: clock.cancel,
  });

  controller.answerChanged("q-num", "number", 4);
  clock.advance(ANSWER_COMMIT_IDLE_MS - 1);
  assert.equal(events.length, 0);
  clock.advance(1);
  assert.deepEqual(events, [
    { eventType: "ANSWER_CHANGED", questionId: "q-num", metadata: { valuePresent: true } },
  ]);

  controller.answerChanged("q-area", "textarea", "");
  controller.flushAnswers();
  assert.deepEqual(events[1], {
    eventType: "ANSWER_CHANGED",
    questionId: "q-area",
    metadata: { valuePresent: false },
  });

  // After "Clear answers", re-selecting the previous value is recorded again.
  controller.answerChanged("q-rate", "rating", 5);
  controller.answersCleared();
  controller.answerChanged("q-rate", "rating", 5);
  assert.equal(events.filter((event) => event.questionId === "q-rate").length, 2);
});

test("marks each question as shown only once", () => {
  const shown = new Set();
  assert.equal(markQuestionShown(shown, "q1"), true);
  assert.equal(markQuestionShown(shown, "q1"), false);
  assert.equal(markQuestionShown(shown, "q2"), true);
  assert.equal(markQuestionShown(shown, ""), false);
});
