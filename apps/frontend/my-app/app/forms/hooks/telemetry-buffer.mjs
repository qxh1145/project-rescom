export const TELEMETRY_QUEUE_MAX = 100;

export function createTelemetryQueue(maxSize = 100) {
  void maxSize;
  return [];
}

export function enqueueEvent(queue, event, maxSize = 100) {
  if (!queue || !event) return;
  if (queue.length >= maxSize) {
    queue.shift(); // Drop oldest event to prevent memory growth
  }
  queue.push(event);
}

export function drainBatch(queue, batchSize = 20) {
  if (!queue || queue.length === 0) return [];
  return queue.splice(0, Math.min(queue.length, batchSize));
}

export function formatTelemetryPayload(events, consentNoticeVersion) {
  const payload = {
    events,
  };
  if (consentNoticeVersion) {
    payload.consentNoticeVersion = consentNoticeVersion;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Epic 5 review P15: delivery failures must not silently drop events, and a
// malformed fallback id must not poison a whole batch.
// ---------------------------------------------------------------------------

/**
 * Puts a failed batch back at the front of the queue (preserving order) and
 * bounds the queue to `maxSize`, dropping the oldest events first.
 */
export function requeueBatch(queue, batch, maxSize = TELEMETRY_QUEUE_MAX) {
  if (!queue || !Array.isArray(batch) || batch.length === 0) return queue;
  queue.unshift(...batch);
  if (queue.length > maxSize) {
    queue.splice(0, queue.length - maxSize);
  }
  return queue;
}

/**
 * Classifies a telemetry POST outcome. `status` is null/undefined for a
 * network error. Returns "ok", "retry" (network error, 5xx, 429) or "drop"
 * (any other non-2xx: the batch is invalid and resending cannot help).
 *
 * @param {number | null | undefined} status
 * @returns {"ok" | "retry" | "drop"}
 */
export function classifyTelemetryResponse(status) {
  if (typeof status !== "number" || !Number.isFinite(status)) return "retry";
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status >= 500) return "retry";
  return "drop";
}

export function resolveTelemetryUrl({ responseId, formId, attemptId } = {}) {
  if (responseId) return `/api/responses/${responseId}/integrity-events`;
  if (formId && attemptId) {
    return `/api/forms/${formId}/attempts/${attemptId}/integrity-events`;
  }
  return null;
}

function toHex(byte) {
  return byte.toString(16).padStart(2, "0");
}

/** Formats 16 random bytes as an RFC 4122 version-4 UUID. */
export function uuidV4FromBytes(bytes) {
  const b = Array.from(bytes, (value) => value & 0xff);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.map(toHex).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Client event ids must be UUIDs (`z.string().uuid()` on the backend).
 * Prefers `crypto.randomUUID`, then `crypto.getRandomValues`, and only as a
 * last resort `Math.random` — always in UUID v4 format.
 */
export function createClientEventId(cryptoLike = globalThis.crypto) {
  if (cryptoLike && typeof cryptoLike.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (cryptoLike && typeof cryptoLike.getRandomValues === "function") {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return uuidV4FromBytes(bytes);
}

// ---------------------------------------------------------------------------
// Epic 5 review P13: question-level telemetry without keystroke logging.
// ---------------------------------------------------------------------------

const SELECT_BLOCK_TYPES = new Set([
  "single_choice",
  "multiple_choice",
  "rating",
  "linear_scale",
  "date",
]);
const TYPED_BLOCK_TYPES = new Set(["text", "textarea", "number"]);

/** Idle time after the last change before a typed answer is committed. */
export const ANSWER_COMMIT_IDLE_MS = 1500;

/**
 * Telemetry event recorded when a block's answer changes (null = none).
 *
 * @param {string} blockType
 * @returns {"ANSWER_SELECTED" | "ANSWER_CHANGED" | null}
 */
export function answerEventTypeFor(blockType) {
  if (SELECT_BLOCK_TYPES.has(blockType)) return "ANSWER_SELECTED";
  if (TYPED_BLOCK_TYPES.has(blockType) || blockType === "file_upload") {
    return "ANSWER_CHANGED";
  }
  return null;
}

const TEXT_ENTRY_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "password",
]);

/** True for an element the respondent types into (text inputs, textarea). */
export function isTextEntryElement(element) {
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  const type = typeof element.type === "string" ? element.type.toLowerCase() : "";
  return TEXT_ENTRY_INPUT_TYPES.has(type);
}

/**
 * Typed answers (text/textarea/number, or the "Other..." text of a choice
 * block) are committed on blur or after `ANSWER_COMMIT_IDLE_MS` of idle time,
 * never per keystroke. Other answers are recorded immediately.
 *
 * @param {string} blockType
 * @param {{ typing?: boolean }} [options]
 * @returns {"deferred" | "immediate"}
 */
export function answerCommitModeFor(blockType, { typing = false } = {}) {
  return TYPED_BLOCK_TYPES.has(blockType) || typing ? "deferred" : "immediate";
}

export function isAnswerValuePresent(value) {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Coalesces answer events per question: `change` (re)arms an idle timer and
 * only the latest pending event is emitted — on `flush` (blur/commit) or when
 * the timer fires. Timers are injectable for tests.
 *
 * @typedef {{ eventType: "ANSWER_SELECTED" | "ANSWER_CHANGED", valuePresent: boolean }} AnswerCommitEvent
 * @param {{
 *   emit?: (questionId: string, event: AnswerCommitEvent) => void,
 *   delayMs?: number,
 *   schedule?: (callback: () => void, ms: number) => unknown,
 *   cancel?: (handle: unknown) => void,
 * }} [options]
 */
export function createAnswerCommitDebouncer({
  emit,
  delayMs = ANSWER_COMMIT_IDLE_MS,
  schedule = (callback, ms) => setTimeout(callback, ms),
  cancel = (handle) => clearTimeout(/** @type {any} */ (handle)),
} = {}) {
  const pending = new Map();

  function flush(questionId) {
    const entry = pending.get(questionId);
    if (!entry) return false;
    pending.delete(questionId);
    cancel(entry.handle);
    emit?.(questionId, entry.event);
    return true;
  }

  return {
    change(questionId, event) {
      const existing = pending.get(questionId);
      if (existing) cancel(existing.handle);
      const handle = schedule(() => {
        const current = pending.get(questionId);
        if (current && current.handle === handle) flush(questionId);
      }, delayMs);
      pending.set(questionId, { event, handle });
    },
    flush,
    flushAll() {
      for (const questionId of [...pending.keys()]) flush(questionId);
    },
    discard(questionId) {
      const entry = pending.get(questionId);
      if (!entry) return;
      pending.delete(questionId);
      cancel(entry.handle);
    },
    dispose() {
      for (const entry of pending.values()) cancel(entry.handle);
      pending.clear();
    },
    hasPending(questionId) {
      return pending.has(questionId);
    },
  };
}

/**
 * Tracks which question holds focus so QUESTION_FOCUSED / QUESTION_BLURRED
 * are emitted on transitions only. A blur that stays inside the question is
 * ignored; a blur to nowhere is held as pending so that focus returning to
 * the same question (e.g. clicking an option label) emits nothing. Call
 * `settle()` after a short grace period to commit a pending blur.
 *
 * Each method returns the events to record, in order.
 *
 * @typedef {{ eventType: "QUESTION_FOCUSED" | "QUESTION_BLURRED", questionId: string }} FocusTransitionEvent
 * @returns {{
 *   focus(questionId: string): FocusTransitionEvent[],
 *   blur(questionId: string, options?: { stayingInside?: boolean }): FocusTransitionEvent[],
 *   settle(): FocusTransitionEvent[],
 *   readonly current: string | null,
 * }}
 */
export function createFocusTransitionTracker() {
  /** @type {string | null} */
  let current = null;
  /** @type {string | null} */
  let pendingBlur = null;

  /** @param {FocusTransitionEvent[]} events */
  function commitPendingBlur(events) {
    if (pendingBlur !== null) {
      events.push({ eventType: "QUESTION_BLURRED", questionId: pendingBlur });
      pendingBlur = null;
    }
  }

  return {
    focus(questionId) {
      /** @type {FocusTransitionEvent[]} */
      const events = [];
      if (pendingBlur === questionId) {
        pendingBlur = null;
        current = questionId;
        return events;
      }
      commitPendingBlur(events);
      if (current === questionId) return events;
      if (current !== null) {
        events.push({ eventType: "QUESTION_BLURRED", questionId: current });
      }
      current = questionId;
      events.push({ eventType: "QUESTION_FOCUSED", questionId });
      return events;
    },
    blur(questionId, { stayingInside = false } = {}) {
      /** @type {FocusTransitionEvent[]} */
      const events = [];
      if (stayingInside || current !== questionId) return events;
      current = null;
      commitPendingBlur(events);
      pendingBlur = questionId;
      return events;
    },
    settle() {
      /** @type {FocusTransitionEvent[]} */
      const events = [];
      commitPendingBlur(events);
      return events;
    },
    get current() {
      return current;
    },
  };
}

/** Records `questionId` in `shownSet`; true only the first time (QUESTION_SHOWN). */
export function markQuestionShown(shownSet, questionId) {
  if (!shownSet || !questionId || shownSet.has(questionId)) return false;
  shownSet.add(questionId);
  return true;
}

/** Grace period before a blur to nowhere is committed as QUESTION_BLURRED. */
export const FOCUS_BLUR_GRACE_MS = 300;

/** In-memory identity of an answer value (never sent anywhere). */
function answerSignature(value) {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return null;
  }
}

/**
 * Per-form question telemetry (Epic 5 review P13): focus/blur transitions and
 * answer events. `emit(eventType, questionId, metadata?)` records one event;
 * answer metadata is `{ valuePresent }` only — never the value itself.
 *
 * @typedef {"QUESTION_FOCUSED" | "QUESTION_BLURRED" | "ANSWER_SELECTED" | "ANSWER_CHANGED"} QuestionTelemetryEventType
 * @param {{
 *   emit?: (eventType: QuestionTelemetryEventType, questionId: string, metadata?: { valuePresent: boolean }) => void,
 *   schedule?: (callback: () => void, ms: number) => unknown,
 *   cancel?: (handle: unknown) => void,
 *   commitDelayMs?: number,
 *   blurGraceMs?: number,
 * }} [options]
 */
export function createQuestionTelemetryController({
  emit,
  schedule = (callback, ms) => setTimeout(callback, ms),
  cancel = (handle) => clearTimeout(/** @type {any} */ (handle)),
  commitDelayMs = ANSWER_COMMIT_IDLE_MS,
  blurGraceMs = FOCUS_BLUR_GRACE_MS,
} = {}) {
  const tracker = createFocusTransitionTracker();
  const commits = createAnswerCommitDebouncer({
    emit: (questionId, event) =>
      emit?.(event.eventType, questionId, { valuePresent: event.valuePresent }),
    delayMs: commitDelayMs,
    schedule,
    cancel,
  });
  let settleHandle = null;
  // Last immediately-recorded answer per question: a label click fires the
  // block's onChange several times with the same value — record it once.
  const lastRecordedAnswer = new Map();

  function emitTransitions(events) {
    for (const event of events) emit?.(event.eventType, event.questionId);
  }

  function clearSettle() {
    if (settleHandle !== null) {
      cancel(settleHandle);
      settleHandle = null;
    }
  }

  return {
    /** Focus entered `questionId` (from anywhere). */
    questionFocused(questionId) {
      clearSettle();
      emitTransitions(tracker.focus(questionId));
    },
    /**
     * An element inside `questionId` lost focus. `stayingInside` is true when
     * focus moved to another element of the same question.
     */
    questionBlurred(questionId, { stayingInside = false } = {}) {
      commits.flush(questionId);
      emitTransitions(tracker.blur(questionId, { stayingInside }));
      if (stayingInside) return;
      clearSettle();
      settleHandle = schedule(() => {
        settleHandle = null;
        emitTransitions(tracker.settle());
      }, blurGraceMs);
    },
    /** The answer of `questionId` changed; `typing` = a text field has focus. */
    answerChanged(questionId, blockType, value, { typing = false } = {}) {
      const eventType = answerEventTypeFor(blockType);
      if (!eventType) return;
      const event = { eventType, valuePresent: isAnswerValuePresent(value) };
      if (answerCommitModeFor(blockType, { typing }) === "deferred") {
        lastRecordedAnswer.delete(questionId);
        commits.change(questionId, event);
        return;
      }
      const signature = answerSignature(value);
      if (signature !== null && lastRecordedAnswer.get(questionId) === signature) {
        return;
      }
      lastRecordedAnswer.set(questionId, signature);
      commits.discard(questionId);
      emit?.(eventType, questionId, { valuePresent: event.valuePresent });
    },
    /** Commits every pending typed answer (e.g. before submit). */
    flushAnswers() {
      commits.flushAll();
    },
    /** All answers were cleared: commit pending ones and forget history. */
    answersCleared() {
      commits.flushAll();
      lastRecordedAnswer.clear();
    },
    dispose() {
      clearSettle();
      commits.dispose();
      lastRecordedAnswer.clear();
    },
  };
}
