import test from "node:test";
import assert from "node:assert/strict";

test("Decisions E5-D2 / E5-D4: 30-minute attempt reservation copy for the builder", async (t) => {
  const {
    describeReservationWindow,
    reservationWindowPublishErrorMessage,
    describeNewVersionImpact,
    interruptedAttemptsNotice,
  } = await import("../app/forms/attempt-window.ts");

  const block = { id: "q1", type: "text", order: 0, title: "Q", required: true };

  await t.test("E5-D2: an ordinary survey can be published", () => {
    const hint = describeReservationWindow({
      type: "INTERNAL",
      definition: {
        blocks: [block],
        metadata: { expectedEffortSeconds: 600, minTimeBarrierSeconds: 15 },
      },
      estimatedDurationMinutes: 10,
    });
    assert.deepEqual(hint, { blocksPublish: false, message: null });
  });

  await t.test("E5-D2: a barrier, effort or duration beyond the window blocks publishing", () => {
    const hint = describeReservationWindow({
      type: "INTERNAL",
      definition: {
        blocks: [block],
        metadata: { expectedEffortSeconds: 3600, minTimeBarrierSeconds: 1800 },
      },
      estimatedDurationMinutes: 45,
    });
    assert.equal(hint.blocksPublish, true);
    assert.match(hint.message, /tối thiểu là 1800 giây/);
    assert.match(hint.message, /3600 giây/);
    assert.match(hint.message, /45 phút/);
    assert.match(hint.message, /Giai đoạn 1 chưa hỗ trợ khảo sát dài hơn 30 phút/);

    const external = describeReservationWindow({
      type: "EXTERNAL",
      definition: { blocks: [], metadata: { expectedEffortSeconds: 1700, minTimeBarrierSeconds: 1600 } },
      estimatedDurationMinutes: null,
    });
    assert.equal(external.blocksPublish, true);
  });

  await t.test("E5-D2: words the backend 422 and ignores other errors", () => {
    const message = reservationWindowPublishErrorMessage(
      "SURVEY_DURATION_EXCEEDS_RESERVATION",
      [{ rule: "ESTIMATED_DURATION", estimatedDurationMinutes: 40, maxMinutes: 30 }],
    );
    assert.match(message, /40 phút, vượt quá 30 phút/);
    assert.match(
      reservationWindowPublishErrorMessage("SURVEY_DURATION_EXCEEDS_RESERVATION", null),
      /Giai đoạn 1/,
    );
    assert.equal(reservationWindowPublishErrorMessage("FORM_VALIDATION_ERROR", []), null);
  });

  await t.test("E5-D4: warns about in-progress respondents before Create New Version", () => {
    const busy = describeNewVersionImpact(3);
    assert.equal(busy.tone, "warning");
    assert.match(busy.message, /Có 3 người đang làm khảo sát này/);
    assert.match(busy.message, /không thể nộp/);

    const idle = describeNewVersionImpact(0);
    assert.equal(idle.tone, "info");
    assert.match(idle.message, /không có ai đang làm/);

    // Unknown (loading or failed): still warn about the strict cut-off.
    const unknown = describeNewVersionImpact(null);
    assert.equal(unknown.tone, "warning");
    assert.match(unknown.message, /đóng khảo sát đang chạy ngay lập tức/);
  });

  await t.test("E5-D4: reports interrupted attempts after the version was created", () => {
    assert.match(interruptedAttemptsNotice(2, 4), /phiên bản 2.*4 lượt làm bài đang dở/);
    assert.doesNotMatch(interruptedAttemptsNotice(2, 0), /lượt làm bài đang dở/);
    assert.doesNotMatch(interruptedAttemptsNotice(2, undefined), /lượt làm bài đang dở/);
  });
});

test("Decision E5-D4: live client for the in-progress attempts count", async (t) => {
  const { fetchInProgressAttempts } = await import("../app/forms/forms-api.ts");

  await t.test("reads the count from the success envelope", async () => {
    const calls = [];
    const data = {
      formId: "f-1",
      status: "PUBLISHED",
      inProgressAttempts: 2,
      reservationWindowMinutes: 30,
    };
    const result = await fetchInProgressAttempts("f-1", async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data, error: null }) };
    });
    assert.deepEqual(result, data);
    assert.equal(calls[0].url, "/api/forms/f-1/in-progress-attempts");
    assert.equal(calls[0].init.credentials, "same-origin");
  });

  await t.test("surfaces the backend error message", async () => {
    await assert.rejects(
      () =>
        fetchInProgressAttempts("f-1", async () => ({
          ok: false,
          status: 403,
          json: async () => ({ data: null, error: { code: "FORM_FORBIDDEN", message: "Forbidden" } }),
        })),
      /Forbidden/,
    );
  });
});
