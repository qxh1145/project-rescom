import test from "node:test";
import assert from "node:assert/strict";

function createMockStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

const TOO_FAST_DETAILS = {
  requiredSeconds: 10,
  elapsedSeconds: 3,
  remainingSeconds: 7,
  retryAfterSeconds: 7,
  earliestSubmitAt: "2026-09-26T10:00:10.000Z",
  questionCount: 5,
  secondsPerQuestion: 2,
  publisherMinimumSeconds: 4,
  policyVersion: "time-barrier-v1",
};

const RATE_LIMIT_DETAILS = {
  scope: "COMPLETIONS",
  limit: 20,
  windowSeconds: 3600,
  retryAfterSeconds: 1500,
  retryAt: "2026-09-26T12:25:00.000Z",
  policyVersion: "participation-rate-limit-v1",
};

test("Story 8.2: participation guard helpers", async (t) => {
  const guards = await import("../lib/participation-guards.ts");

  await t.test("recognises structured bot-protection errors only", () => {
    const tooFast = guards.getParticipationGuard({
      code: "SUBMISSION_TOO_FAST",
      details: TOO_FAST_DETAILS,
    });
    assert.equal(tooFast.kind, "TIME_BARRIER");
    assert.equal(tooFast.remainingSeconds, 7);

    const limited = guards.getParticipationGuard({
      code: "PARTICIPATION_RATE_LIMITED",
      details: RATE_LIMIT_DETAILS,
    });
    assert.equal(limited.kind, "RATE_LIMIT");
    assert.equal(limited.scope, "COMPLETIONS");

    assert.equal(
      guards.getParticipationGuard({ code: "SUBMISSION_TOO_FAST", details: { nope: 1 } }),
      null,
    );
    assert.equal(guards.getParticipationGuard({ code: "ATTEMPT_LOCKED" }), null);
    assert.equal(guards.getParticipationGuard(new Error("x")), null);
    assert.equal(guards.getParticipationGuard(null), null);
  });

  await t.test("formats Vietnamese wait durations", () => {
    assert.equal(guards.formatWaitDuration(0), "0 giây");
    assert.equal(guards.formatWaitDuration(45), "45 giây");
    assert.equal(guards.formatWaitDuration(60), "1 phút");
    assert.equal(guards.formatWaitDuration(61), "2 phút");
    assert.equal(guards.formatWaitDuration(3600), "1 giờ");
    assert.equal(guards.formatWaitDuration(3900), "1 giờ 5 phút");
  });

  await t.test("explains the rule and the wait in friendly copy", () => {
    const tooFast = guards.getParticipationGuard({
      code: "SUBMISSION_TOO_FAST",
      details: TOO_FAST_DETAILS,
    });
    const message = guards.describeParticipationGuard(tooFast);
    assert.match(message, /ít nhất 10 giây/);
    assert.match(message, /5 câu hỏi × 2 giây/);
    assert.match(message, /7 giây/);
    assert.match(message, /giữ nguyên/);

    const limited = guards.getParticipationGuard({
      code: "PARTICIPATION_RATE_LIMITED",
      details: RATE_LIMIT_DETAILS,
    });
    assert.match(guards.describeParticipationGuard(limited), /20 khảo sát trong 1 giờ/);
    assert.match(guards.describeParticipationGuard(limited), /25 phút/);
    assert.match(
      guards.describeParticipationGuard({ ...limited, scope: "ATTEMPT_START" }, 30),
      /thao tác quá nhanh.*30 giây/,
    );
    // Decision E8-D6: a start refused because open attempts hold capacity.
    const reserved = guards.getParticipationGuard({
      code: "PARTICIPATION_RATE_LIMITED",
      details: { ...RATE_LIMIT_DETAILS, completionsInWindow: 18, inProgressAttempts: 2 },
    });
    assert.equal(reserved.inProgressAttempts, 2);
    assert.match(
      guards.describeParticipationGuard(reserved),
      /18 khảo sát đã hoàn thành và 2 khảo sát đang làm dở/,
    );
    assert.equal(
      guards.describeTimeBarrierRule({
        requiredSeconds: 15,
        questionCount: 2,
        secondsPerQuestion: 2,
      }),
      "mức tối thiểu của khảo sát (áp dụng cho 2 câu hỏi)",
    );
  });

  await t.test("counts seconds until a server time", () => {
    const now = Date.parse("2026-09-26T10:00:00.000Z");
    assert.equal(guards.secondsUntil("2026-09-26T10:00:07.200Z", now), 8);
    assert.equal(guards.secondsUntil("2026-09-26T09:59:00.000Z", now), 0);
    assert.equal(guards.secondsUntil("garbage", now), 0);
  });
});

test("Story 8.2: mock repository mirrors the bot protection rules", async (t) => {
  const { mockRepository } = await import("../lib/mock/repository.ts");
  const store = await import("../lib/mock/store.ts");
  const { computeInternalTimeBarrier, DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY } =
    await import("@rescom/schemas");

  t.beforeEach(async () => {
    store.setMockStorage(createMockStorage());
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
    await mockRepository.switchDemoUser("user-active-002");
  });

  function backdate(attempt, seconds) {
    store.saveAttempt({
      ...store.getAttempt(attempt.attemptId),
      startedAt: new Date(Date.now() - seconds * 1000).toISOString(),
    });
  }

  function seedCompletions(userId, count, minutesAgo = 10) {
    for (let i = 0; i < count; i += 1) {
      const completedAt = new Date(Date.now() - (minutesAgo + i) * 60_000).toISOString();
      store.saveAttempt({
        attemptId: `seed-${userId}-${i}`,
        surveyId: "survey-int-003",
        formVersionId: "ver-int-003",
        userId,
        type: "INTERNAL",
        status: "COMPLETED",
        startedAt: completedAt,
        completedAt,
        expiresAt: completedAt,
        rewardPerResponse: 0,
        minTimeBarrierSeconds: 0,
        responseId: null,
      });
    }
  }

  await t.test("computes the Internal barrier with the shared helper (questions × 2 s)", async () => {
    const survey = await mockRepository.getSurveyById("survey-int-002");
    const expected = computeInternalTimeBarrier({
      blocks: survey.blocks,
      metadata: survey.metadata,
    });
    assert.equal(expected.requiredSeconds, 6); // 3 questions × 2 s > publisher 4 s

    const attempt = await mockRepository.startSurveyAttempt("survey-int-002");
    assert.equal(attempt.minTimeBarrierSeconds, 6);
    assert.equal(attempt.questionCount, 3);

    const status = await mockRepository.getTimeBarrierStatus(attempt.attemptId);
    assert.equal(status.requiredSeconds, 6);
    assert.equal(status.passed, false);
    assert.ok(status.remainingSeconds > 0 && status.remainingSeconds <= 6);
  });

  await t.test("rejects a too-fast Internal submission without consuming the attempt, then accepts it", async () => {
    const walletBefore = await mockRepository.getWalletDetails();
    const attempt = await mockRepository.startSurveyAttempt("survey-int-002");

    await assert.rejects(
      () => mockRepository.submitInternalSurvey(attempt.attemptId, {}),
      (err) =>
        err.code === "SUBMISSION_TOO_FAST" &&
        err.details.requiredSeconds === 6 &&
        err.details.questionCount === 3 &&
        err.details.remainingSeconds > 0 &&
        /Thời gian làm bài quá ngắn/.test(err.message),
    );
    assert.equal(store.getAttempt(attempt.attemptId).status, "IN_PROGRESS");
    const walletAfterReject = await mockRepository.getWalletDetails();
    assert.equal(walletAfterReject.balance.available, walletBefore.balance.available);

    backdate(attempt, 7);
    const status = await mockRepository.getTimeBarrierStatus(attempt.attemptId);
    assert.equal(status.passed, true);
    assert.equal(status.remainingSeconds, 0);

    const result = await mockRepository.submitInternalSurvey(attempt.attemptId, {});
    assert.equal(result.success, true);
  });

  await t.test("External too-fast errors are structured too", async () => {
    const attempt = await mockRepository.startSurveyAttempt("survey-ext-001");
    await assert.rejects(
      () => mockRepository.submitExternalSurvey(attempt.attemptId, "689201"),
      (err) =>
        err.code === "SUBMISSION_TOO_FAST" &&
        err.details.questionCount === null &&
        err.details.requiredSeconds === attempt.minTimeBarrierSeconds,
    );
    assert.equal(store.getAttempt(attempt.attemptId).failedCodeAttempts ?? 0, 0);
  });

  await t.test("blocks new attempts at the completion limit (FR-46)", async () => {
    const { limit } = { limit: DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionLimit };
    seedCompletions("user-active-002", limit);

    await assert.rejects(
      () => mockRepository.startSurveyAttempt("survey-int-002"),
      (err) =>
        err.code === "PARTICIPATION_RATE_LIMITED" &&
        err.details.scope === "COMPLETIONS" &&
        err.details.limit === limit &&
        err.details.retryAfterSeconds > 0 &&
        /khảo sát trong 1 giờ/.test(err.message),
    );
  });

  await t.test("decision E8-D6: an open attempt reserves capacity, so the next start is refused up front", async () => {
    const limit = DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionLimit;
    seedCompletions("user-active-002", limit - 1);
    const open = await mockRepository.startSurveyAttempt("survey-int-002");

    await assert.rejects(
      () => mockRepository.startSurveyAttempt("survey-ext-001"),
      (err) =>
        err.code === "PARTICIPATION_RATE_LIMITED" &&
        err.details.scope === "COMPLETIONS" &&
        err.details.completionsInWindow === limit - 1 &&
        err.details.inProgressAttempts === 1 &&
        /đang làm dở/.test(err.message),
    );

    // The reserved attempt can always be submitted (no limit check at submit).
    backdate(open, 30);
    const result = await mockRepository.submitInternalSurvey(open.attemptId, {});
    assert.equal(result.success, true);
  });

  await t.test("decision E8-D6: submit and code verification never re-check the limit", async () => {
    const attempt = await mockRepository.startSurveyAttempt("survey-int-002");
    backdate(attempt, 30);
    // Completions that bypassed the reservation (e.g. seeded demo history).
    seedCompletions("user-active-002", DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionLimit, 1);

    const result = await mockRepository.submitInternalSurvey(attempt.attemptId, {});
    assert.equal(result.success, true);
    assert.equal(store.getAttempt(attempt.attemptId).status, "COMPLETED");
  });

  await t.test("decision E8-D6: an expired open attempt releases its reservation", async () => {
    const limit = DEFAULT_PARTICIPATION_RATE_LIMIT_POLICY.completionLimit;
    seedCompletions("user-active-002", limit - 1);
    const stale = await mockRepository.startSurveyAttempt("survey-int-002");
    backdate(stale, 31 * 60);

    const next = await mockRepository.startSurveyAttempt("survey-ext-001");
    assert.equal(next.status, "IN_PROGRESS");
  });
});
