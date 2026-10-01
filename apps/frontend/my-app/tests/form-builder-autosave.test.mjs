import assert from "node:assert/strict";
import test from "node:test";

const { createAutosaveController, autosaveLabel } = await import("../lib/forms/builder-autosave.ts");
const offline = await import("../lib/forms/builder-offline.ts");
const blocks = await import("../lib/forms/builder-blocks.ts");
const publish = await import("../lib/forms/builder-publish.ts");
const schemas = await import("@rescom/schemas");

function fakeTimers() {
  const timers = new Map();
  let next = 1;
  return {
    setTimer(callback) {
      const id = next++;
      timers.set(id, callback);
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fire() {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, callback] of pending) callback();
    },
    get size() {
      return timers.size;
    },
  };
}

const conflict = Object.assign(new Error("conflict"), { code: "FORM_EDIT_CONFLICT" });
const offlineError = Object.assign(new Error("offline"), { kind: "network" });
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup(save) {
  const timers = fakeTimers();
  const states = [];
  const controller = createAutosaveController({
    delayMs: 1000,
    save,
    isConflict: (e) => e?.code === "FORM_EDIT_CONFLICT",
    isOffline: (e) => e?.kind === "network",
    onChange: (s) => states.push(s.status),
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  controller.setBaseline("2026-09-27T10:00:00.000Z");
  return { controller, timers, states };
}

test("debounces bursts into one save with the latest payload and chains updatedAt", async () => {
  const calls = [];
  let version = 0;
  const { controller, timers } = setup(async (payload, clientUpdatedAt) => {
    calls.push({ payload, clientUpdatedAt });
    version += 1;
    return { updatedAt: `2026-09-27T10:00:0${version}.000Z` };
  });
  controller.queue("a");
  controller.queue("b");
  controller.queue("c");
  assert.equal(timers.size, 1);
  assert.equal(calls.length, 0);
  timers.fire();
  await tick();
  assert.deepEqual(calls, [{ payload: "c", clientUpdatedAt: "2026-09-27T10:00:00.000Z" }]);
  controller.queue("d");
  await controller.flush();
  assert.equal(calls[1].clientUpdatedAt, "2026-09-27T10:00:01.000Z");
  assert.equal(controller.snapshot().status, "saved");
  assert.equal(controller.snapshot().hasPending, false);
});

test("an edit made while saving is saved right after, never in parallel", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const payloads = [];
  let release;
  const { controller } = setup(async (payload) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    payloads.push(payload);
    if (payloads.length === 1) await new Promise((resolve) => (release = resolve));
    inFlight -= 1;
    return { updatedAt: `2026-09-27T10:00:1${payloads.length}.000Z` };
  });
  controller.queue("first");
  const flushing = controller.flush();
  await tick();
  controller.queue("second");
  release();
  await flushing;
  await controller.flush();
  assert.deepEqual(payloads, ["first", "second"]);
  assert.equal(maxInFlight, 1);
});

test("409 FORM_EDIT_CONFLICT stops autosave and keeps the edit until resolved", async () => {
  let fail = true;
  const calls = [];
  const { controller, timers } = setup(async (payload, clientUpdatedAt) => {
    calls.push(clientUpdatedAt);
    if (fail) throw conflict;
    return { updatedAt: "2026-09-27T11:00:00.000Z" };
  });
  controller.queue("mine");
  await controller.flush();
  assert.equal(controller.snapshot().status, "conflict");
  assert.equal(controller.snapshot().hasPending, true);
  controller.queue("mine-2");
  timers.fire();
  await tick();
  assert.equal(calls.length, 1, "no retry while in conflict");
  // "Ghi đè": take the server's current version as the baseline, then save.
  fail = false;
  controller.setBaseline("2026-09-27T10:30:00.000Z");
  await controller.flush();
  assert.equal(calls.at(-1), "2026-09-27T10:30:00.000Z");
  assert.equal(controller.snapshot().status, "saved");
});

test("a network failure keeps the payload for the next flush", async () => {
  let online = false;
  const { controller } = setup(async () => {
    if (!online) throw offlineError;
    return { updatedAt: "2026-09-27T12:00:00.000Z" };
  });
  controller.queue("x");
  await controller.flush();
  assert.equal(controller.snapshot().status, "offline");
  online = true;
  await controller.flush();
  assert.equal(controller.snapshot().status, "saved");
  assert.equal(autosaveLabel(controller.snapshot(), false, () => "12:00"), "đã lưu lúc 12:00");
  assert.equal(autosaveLabel(controller.snapshot(), true, () => "12:00"), "Chưa lưu · sửa các câu được đánh dấu");
});

test("discardPending drops the queued edit (e.g. after loading the server version)", async () => {
  let calls = 0;
  const { controller, timers } = setup(async () => {
    calls += 1;
    return { updatedAt: "2026-09-27T12:00:00.000Z" };
  });
  controller.queue("x");
  controller.discardPending();
  timers.fire();
  await controller.flush();
  assert.equal(calls, 0);
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

test("offline cache round-trips a draft and decides how to restore", () => {
  const storage = memoryStorage();
  const doc = blocks.insertBlock(blocks.emptyDoc(), "rating").doc;
  const formId = "7c2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4f99";
  assert.equal(offline.saveLocalDraft(storage, { formId, baseUpdatedAt: "T1", dirty: true, doc, pending: [], aiBlockIds: [] }, 1000), true);
  const local = offline.loadLocalDraft(storage, formId, 2000);
  assert.equal(local.doc.blocks[0].type, "rating");
  assert.equal(offline.decideRestore(local, "T1"), "restore");
  assert.equal(offline.decideRestore(local, "T2"), "ask");
  assert.equal(offline.decideRestore({ ...local, dirty: false }, "T2"), "use-server");
  assert.equal(offline.decideRestore(null, "T1"), "use-server");
  // Expired or corrupt entries are dropped.
  assert.equal(offline.loadLocalDraft(storage, formId, 1000 + offline.BUILDER_DRAFT_MAX_AGE_MS + 1), null);
  assert.equal(storage.map.size, 0);
  storage.setItem(offline.builderDraftKey(formId), "{oops");
  assert.equal(offline.loadLocalDraft(storage, formId), null);
});

test("publish helpers: price hint = reward band + Internal price, and settings validation", () => {
  // C2 (a): the respondent's band (what the reward field is checked against) + what the publisher pays.
  assert.deepEqual(publish.internalPriceHint(5), {
    min: 10,
    max: 20,
    label: "10–20 điểm/lượt",
    paidMin: 8,
    paidMax: 16,
    paidLabel: "bạn trả 8–16 điểm/lượt",
  });
  assert.equal(publish.internalPriceHint(3).label, "5–10 điểm/lượt");
  // The band follows the backend's effective duration: effort longer than the estimate wins.
  const definition = { blocks: [{ type: "rating" }], metadata: { expectedEffortSeconds: 12 * 60, minTimeBarrierSeconds: 15 } };
  assert.equal(publish.internalPriceHint(3, definition).label, "15–25 điểm/lượt");
  assert.equal(publish.internalPriceHint(3, definition).paidLabel, "bạn trả 12–20 điểm/lượt");
  assert.equal(publish.estimateEscrow({ expectedCompletions: 30, rewardPerResponse: 12 }), 30 * 10);
  const ok = publish.validatePublishSettings({ expectedCompletions: "30", rewardPerResponse: "12", estimatedDurationMinutes: "5" });
  assert.deepEqual(ok, { ok: true, value: { expectedCompletions: 30, rewardPerResponse: 12, estimatedDurationMinutes: 5 } });
  const bad = publish.validatePublishSettings({ expectedCompletions: "", rewardPerResponse: "-1", estimatedDurationMinutes: "2.5" });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.expectedCompletions, "Trường này là bắt buộc.");
  assert.equal(bad.errors.rewardPerResponse, "Điểm không được âm.");
  assert.equal(bad.errors.estimatedDurationMinutes, "Thời lượng tính bằng phút.");
  // C1: the duration is capped at the 30-minute attempt reservation.
  assert.equal(publish.validatePublishSettings({ expectedCompletions: "30", rewardPerResponse: "20", estimatedDurationMinutes: "30" }).ok, true);
  const long = publish.validatePublishSettings({ expectedCompletions: "30", rewardPerResponse: "20", estimatedDurationMinutes: "31" });
  assert.equal(long.ok, false);
  assert.match(long.errors.estimatedDurationMinutes, /Tối đa 30 phút/);
});

test("publish helpers: isValidDurationInput mirrors the schema's [1, MAX] bound (FR-14 price hint)", () => {
  assert.equal(publish.isValidDurationInput("5"), true);
  assert.equal(publish.isValidDurationInput("1"), true);
  assert.equal(publish.isValidDurationInput("30"), true);
  // Out of range, non-integer, empty or non-numeric input: never a duration to price from.
  assert.equal(publish.isValidDurationInput("0"), false);
  assert.equal(publish.isValidDurationInput("31"), false);
  assert.equal(publish.isValidDurationInput("99999"), false);
  assert.equal(publish.isValidDurationInput("-5"), false);
  assert.equal(publish.isValidDurationInput("2.5"), false);
  assert.equal(publish.isValidDurationInput("abc"), false);
  assert.equal(publish.isValidDurationInput(""), false);
  assert.equal(publish.isValidDurationInput("   "), false);
  // Surrounding whitespace around an otherwise-valid number is fine.
  assert.equal(publish.isValidDurationInput(" 12 "), true);
});

test("C4: the publish step opens only on a saved, publishable draft", () => {
  const named = {
    ...blocks.emptyDoc(),
    title: "Thói quen học nhóm",
  };
  const { doc } = blocks.insertBlock(named, "rating");
  const ready = { ...doc, blocks: doc.blocks.map((block) => ({ ...block, title: "Chấm điểm căng tin" })) };
  assert.equal(publish.publishReadiness({ doc: ready, localDirty: false }), "ready");
  assert.equal(publish.publishReadiness({ doc: ready, localDirty: true }), "unsaved");
  assert.equal(publish.publishReadiness({ doc, localDirty: false }), "invalid");
  assert.match(publish.PUBLISH_READINESS_NOTICE.unsaved, /chưa lưu/);
  assert.equal(publish.FROZEN_REWARD_HINT, "Giữ nguyên điểm thưởng của phiên bản đã đăng");
});

test("review LOW-17: builder deadline choices never leave a dead end", () => {
  const now = new Date("2026-10-01T03:00:00Z");
  const soon = new Date(now.getTime() + 30 * 60_000).toISOString();
  const later = new Date(now.getTime() + 5 * 86_400_000).toISOString();
  // A stored deadline < 2 h away is not offered as "keep": the publish would be refused.
  assert.equal(publish.builderDeadlineChoices(soon, now)[0].value, "7");
  assert.equal(publish.defaultBuilderDeadlineChoice(soon, now), "14");
  assert.equal(publish.builderDeadlineAt("14", soon, now), "2026-10-15T16:59:59.999Z");
  // A usable one is kept by default; no deadline stays none; "none" clears.
  assert.equal(publish.defaultBuilderDeadlineChoice(later, now), "keep");
  assert.equal(publish.builderDeadlineAt("keep", later, now), later);
  assert.equal(publish.defaultBuilderDeadlineChoice(null, now), "none");
  assert.equal(publish.builderDeadlineAt("none", later, now), null);
  for (const choice of publish.builderDeadlineChoices(later, now)) {
    const at = publish.builderDeadlineAt(choice.value, later, now);
    assert.ok(at === null || schemas.checkFormDeadline(new Date(at), now) === null, choice.value);
  }
});
