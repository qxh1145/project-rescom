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
  };
}

test("Story 9.2: mock post-completion feedback", async (t) => {
  const { submitSurveyFeedbackResultSchema, surveyFeedbackStatusSchema } = await import(
    "@rescom/schemas"
  );
  const { mockRepository } = await import("../mocks/legacy/repository.ts");
  const { setMockStorage, saveAttempt, loadStore, saveStore } = await import(
    "../mocks/legacy/store.ts"
  );

  t.beforeEach(() => {
    setMockStorage(createMockStorage());
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
  });

  /** Starts an attempt as the activated persona and waits out the Time Barrier. */
  async function startAttempt(surveyId) {
    await mockRepository.switchDemoUser("user-active-002");
    const attempt = await mockRepository.startSurveyAttempt(surveyId);
    saveAttempt({
      ...attempt,
      startedAt: new Date(
        Date.now() - (attempt.minTimeBarrierSeconds + 5) * 1000,
      ).toISOString(),
    });
    return attempt;
  }

  async function completeInternal() {
    const attempt = await startAttempt("survey-int-002");
    await mockRepository.submitInternalSurvey(attempt.attemptId, {});
    return attempt;
  }

  /** Makes the activated persona the publisher of a survey (fixtures stay untouched). */
  function makeOwnSurvey(surveyId) {
    const state = loadStore();
    saveStore({
      ...state,
      surveys: {
        ...state.surveys,
        [surveyId]: { ...state.surveys[surveyId], publisherId: "user-active-002" },
      },
    });
  }

  async function snapshotEconomy() {
    const wallet = await mockRepository.getWalletDetails();
    const notifications = await mockRepository.getNotifications({ limit: 50 });
    return {
      balance: wallet.balance,
      transactions: wallet.transactions.length,
      notifications: notifications.total,
    };
  }

  await t.test("an unfinished attempt does not prompt for feedback", async () => {
    const attempt = await startAttempt("survey-int-002");
    const status = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.deepEqual(status, {
      attemptId: attempt.attemptId,
      state: "NOT_ELIGIBLE",
      feedback: null,
    });
    await assert.rejects(
      () => mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 4 }),
      (err) => err.code === "FEEDBACK_NOT_ALLOWED",
    );
  });

  await t.test("Internal: prompt after submission, stored once, rewards untouched", async () => {
    const attempt = await completeInternal();

    const eligible = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.equal(eligible.state, "ELIGIBLE");
    assert.equal(surveyFeedbackStatusSchema.safeParse(eligible).success, true);

    const before = await snapshotEconomy();
    const result = await mockRepository.submitSurveyFeedback(attempt.attemptId, {
      rating: 4,
      comment: "  Câu hỏi rõ ràng, dễ trả lời.  ",
      issueTags: ["TECHNICAL_ISSUE", "UNCLEAR_QUESTIONS", "TECHNICAL_ISSUE"],
    });

    // Same contract as the live API, so the later swap needs no mapping.
    assert.equal(submitSurveyFeedbackResultSchema.safeParse(result).success, true);
    assert.equal(result.replayed, false);
    assert.deepEqual(
      {
        attemptId: result.feedback.attemptId,
        formId: result.feedback.formId,
        formVersionId: result.feedback.formVersionId,
        formType: result.feedback.formType,
        rating: result.feedback.rating,
        comment: result.feedback.comment,
        issueTags: result.feedback.issueTags,
        validationStatus: result.feedback.validationStatus,
      },
      {
        attemptId: attempt.attemptId,
        formId: "survey-int-002",
        formVersionId: attempt.formVersionId,
        formType: "INTERNAL",
        rating: 4,
        comment: "Câu hỏi rõ ràng, dễ trả lời.",
        issueTags: ["UNCLEAR_QUESTIONS", "TECHNICAL_ISSUE"],
        validationStatus: "PENDING",
      },
    );
    assert.equal(Object.hasOwn(result.feedback, "userId"), false);

    // Feedback never changes points or produces notifications.
    assert.deepEqual(await snapshotEconomy(), before);

    const submitted = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.deepEqual(submitted, {
      attemptId: attempt.attemptId,
      state: "SUBMITTED",
      feedback: result.feedback,
    });
  });

  await t.test("identical re-submission is replayed; a different one conflicts", async () => {
    const attempt = await completeInternal();
    const first = await mockRepository.submitSurveyFeedback(attempt.attemptId, {
      rating: 2,
      comment: "Hơi dài",
    });

    const replay = await mockRepository.submitSurveyFeedback(attempt.attemptId, {
      rating: 2,
      comment: " Hơi dài ",
      issueTags: [],
    });
    assert.deepEqual(replay, { feedback: first.feedback, replayed: true });

    await assert.rejects(
      () => mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 5 }),
      (err) => err.code === "FEEDBACK_ALREADY_SUBMITTED",
    );
    const status = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.equal(status.feedback.rating, 2);
  });

  await t.test("External: prompt after the completion code is verified", async () => {
    const attempt = await startAttempt("survey-ext-001");
    await mockRepository.submitExternalSurvey(attempt.attemptId, "689201");

    const result = await mockRepository.submitSurveyFeedback(attempt.attemptId, {
      rating: 1,
      issueTags: ["MISLEADING_DESCRIPTION"],
    });
    assert.equal(result.feedback.formType, "EXTERNAL");
    assert.equal(result.feedback.comment, null);
    assert.deepEqual(result.feedback.issueTags, ["MISLEADING_DESCRIPTION"]);
  });

  await t.test("a publisher cannot rate their own survey", async () => {
    // Decision E4-DN2: an owner can no longer start their own survey, so the
    // ownership changes after the completion (a legacy attempt).
    const attempt = await completeInternal();
    makeOwnSurvey("survey-int-002");

    const status = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.deepEqual(status, {
      attemptId: attempt.attemptId,
      state: "NOT_ELIGIBLE",
      feedback: null,
    });
    await assert.rejects(
      () => mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 5 }),
      (err) => err.code === "FEEDBACK_NOT_ALLOWED",
    );
  });

  await t.test("stored feedback replays or conflicts before the own-survey check", async () => {
    const attempt = await completeInternal();
    const first = await mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 3 });
    makeOwnSurvey("survey-int-002");

    const status = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.equal(status.state, "SUBMITTED");
    assert.deepEqual(
      await mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 3 }),
      { feedback: first.feedback, replayed: true },
    );
    await assert.rejects(
      () => mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 1 }),
      (err) => err.code === "FEEDBACK_ALREADY_SUBMITTED",
    );
  });

  await t.test("validates rating, comment length and tags with the shared schema", async () => {
    const attempt = await completeInternal();
    for (const input of [
      {},
      { rating: 0 },
      { rating: 6 },
      { rating: 4.5 },
      { rating: 3, comment: "x".repeat(501) },
      { rating: 3, issueTags: ["SPAM"] },
    ]) {
      await assert.rejects(
        () => mockRepository.submitSurveyFeedback(attempt.attemptId, input),
        (err) => err.code === "VALIDATION_ERROR",
      );
    }
    const status = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.equal(status.state, "ELIGIBLE");
  });

  await t.test("another user's or an unknown attempt is not found", async () => {
    const attempt = await completeInternal();
    await mockRepository.switchDemoUser("user-new-001");

    await assert.rejects(
      () => mockRepository.getSurveyFeedbackStatus(attempt.attemptId),
      (err) => err.code === "FEEDBACK_ATTEMPT_NOT_FOUND",
    );
    await assert.rejects(
      () => mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 5 }),
      (err) => err.code === "FEEDBACK_ATTEMPT_NOT_FOUND",
    );
    await assert.rejects(
      () => mockRepository.submitSurveyFeedback("att-unknown", { rating: 5 }),
      (err) => err.code === "FEEDBACK_ATTEMPT_NOT_FOUND",
    );
  });

  await t.test("requires a signed-in user", async () => {
    const attempt = await completeInternal();
    await mockRepository.logout();
    await assert.rejects(
      () => mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 5 }),
      (err) => err.code === "AUTH_REQUIRED",
    );
  });

  await t.test("tolerates persisted stores created before feedback existed", async () => {
    const attempt = await completeInternal();
    const state = loadStore();
    delete state.surveyFeedback;
    saveStore(state);

    const status = await mockRepository.getSurveyFeedbackStatus(attempt.attemptId);
    assert.equal(status.state, "ELIGIBLE");
    const result = await mockRepository.submitSurveyFeedback(attempt.attemptId, {
      rating: 3,
    });
    assert.equal(result.replayed, false);
  });

  await t.test("reset clears stored feedback", async () => {
    const attempt = await completeInternal();
    await mockRepository.submitSurveyFeedback(attempt.attemptId, { rating: 5 });
    await mockRepository.resetDemo();
    assert.deepEqual(loadStore().surveyFeedback, {});
  });
});

test("Story 9.2: survey feedback service (lib/participation/feedback-service.ts)", async (t) => {
  const originalFetch = globalThis.fetch;
  const api = await import("../lib/participation/feedback-service.ts");
  const { resetCsrfToken } = await import("../lib/api/client.ts");
  const { feedbackErrorMessage } = await import("../lib/participation/participation-messages.ts");
  const attemptId = "22222222-2222-4222-8222-222222222222";
  const feedback = {
    id: "11111111-1111-4111-8111-111111111111",
    attemptId,
    formId: "33333333-3333-4333-8333-333333333333",
    formVersionId: "44444444-4444-4444-8444-444444444444",
    formType: "INTERNAL",
    rating: 4,
    comment: "Ổn",
    issueTags: ["TECHNICAL_ISSUE"],
    validationStatus: "PENDING",
    submittedAt: "2026-09-26T10:00:00.000Z",
  };
  const calls = [];

  function respond(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function installFetch(handler) {
    calls.length = 0;
    resetCsrfToken();
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/auth/csrf") {
        return respond(200, { data: { csrfToken: "csrf-token-1" } });
      }
      return handler(String(url), init);
    };
  }

  try {
    await t.test("getSurveyFeedbackStatus reads and validates the status", async () => {
      const status = { attemptId, state: "ELIGIBLE", feedback: null };
      installFetch(() => respond(200, { data: status, error: null, meta: {} }));

      assert.deepEqual(await api.getSurveyFeedbackStatus(attemptId), status);
      assert.equal(calls[0].url, `/api/attempts/${attemptId}/feedback`);
      assert.equal(calls[0].init.method ?? "GET", "GET");
    });

    await t.test("submitSurveyFeedback sends a normalized CSRF-protected JSON POST", async () => {
      installFetch(() => respond(200, { data: { feedback, replayed: false }, error: null, meta: {} }));

      const result = await api.submitSurveyFeedback(attemptId, {
        rating: 4,
        comment: "  Ổn  ",
        issueTags: ["TECHNICAL_ISSUE"],
      });

      assert.deepEqual(result, { feedback, replayed: false });
      const post = calls.find((c) => c.url === `/api/attempts/${attemptId}/feedback`);
      assert.equal(post.init.method, "POST");
      assert.equal(post.init.headers["X-CSRF-Token"], "csrf-token-1");
      assert.equal(post.init.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(post.init.body), {
        rating: 4,
        comment: "Ổn",
        issueTags: ["TECHNICAL_ISSUE"],
      });
    });

    await t.test("rejects invalid input before calling the API", async () => {
      installFetch(() => respond(200, {}));
      await assert.rejects(
        () => api.submitSurveyFeedback(attemptId, { rating: 9 }),
        (err) =>
          err.code === "VALIDATION_ERROR" &&
          err.message === "Vui lòng chọn số sao từ 1 đến 5." &&
          feedbackErrorMessage(err) === "Vui lòng chọn số sao từ 1 đến 5.",
      );
      assert.equal(calls.length, 0);
    });

    await t.test("surfaces the API error code and the shared Vietnamese copy", async () => {
      installFetch(() =>
        respond(409, {
          data: null,
          error: {
            code: "FEEDBACK_ALREADY_SUBMITTED",
            message: "Feedback for this survey attempt has already been submitted.",
          },
        }),
      );
      await assert.rejects(
        () => api.submitSurveyFeedback(attemptId, { rating: 2 }),
        (err) =>
          err.code === "FEEDBACK_ALREADY_SUBMITTED" &&
          err.status === 409 &&
          feedbackErrorMessage(err) === "Bạn đã gửi đánh giá cho lượt khảo sát này và không thể thay đổi.",
      );
    });

    await t.test("unknown codes and network failures get generic copy", async () => {
      installFetch(() => respond(503, { data: null, error: { code: "SERVICE_DOWN", message: "Tạm ngưng." } }));
      await assert.rejects(
        () => api.getSurveyFeedbackStatus(attemptId),
        (err) => err.code === "SERVICE_DOWN" && feedbackErrorMessage(err) === "Không gửi được đánh giá. Vui lòng thử lại.",
      );
      installFetch(() => {
        throw new TypeError("Failed to fetch");
      });
      await assert.rejects(
        () => api.getSurveyFeedbackStatus(attemptId),
        (err) => err.kind === "network" && /Không kết nối được máy chủ/.test(feedbackErrorMessage(err)),
      );
    });

    await t.test("rejects malformed payloads", async () => {
      installFetch(() => respond(200, { data: { attemptId, state: "MAYBE" } }));
      await assert.rejects(() => api.getSurveyFeedbackStatus(attemptId), (err) => err.kind === "malformed");
    });
  } finally {
    globalThis.fetch = originalFetch;
    resetCsrfToken();
  }
});

test("Story 9.2: feedback failure handling helper", async () => {
  const { resolveSurveyFeedbackFailure, describeSurveyFeedbackValidationIssue } = await import(
    "../lib/survey-feedback.ts"
  );
  // Errors a retry can never fix hide the prompt or show the stored feedback.
  assert.equal(resolveSurveyFeedbackFailure({ code: "FEEDBACK_ALREADY_SUBMITTED" }), "SHOW_SUBMITTED");
  assert.equal(resolveSurveyFeedbackFailure({ code: "FEEDBACK_ATTEMPT_NOT_FOUND" }), "HIDE");
  assert.equal(resolveSurveyFeedbackFailure({ code: "FEEDBACK_NOT_ALLOWED" }), "HIDE");
  assert.equal(resolveSurveyFeedbackFailure({ code: "AUTH_REQUIRED" }), "HIDE");
  assert.equal(resolveSurveyFeedbackFailure({ code: "AUTH_USER_LOCKED" }), "HIDE");
  // CSRF/origin 403s can be recovered by `formMutationFetch`, so they retry.
  assert.equal(resolveSurveyFeedbackFailure({ code: "AUTH_INVALID_CSRF_TOKEN" }), "RETRY");
  assert.equal(resolveSurveyFeedbackFailure({ code: "AUTH_FORBIDDEN_ORIGIN" }), "RETRY");
  assert.equal(resolveSurveyFeedbackFailure(new Error("network")), "RETRY");
  assert.equal(resolveSurveyFeedbackFailure(null), "RETRY");
  assert.equal(describeSurveyFeedbackValidationIssue("comment"), "Nhận xét tối đa 500 ký tự.");
  assert.equal(describeSurveyFeedbackValidationIssue(undefined), "Dữ liệu đánh giá không hợp lệ.");
});

test("decision E9-D4: the thank-you note makes no Publisher-anonymity promise", async () => {
  const { readFile } = await import("node:fs/promises");
  const { SURVEY_FEEDBACK_THANK_YOU_NOTE } = await import("../lib/survey-feedback.ts");

  // The rest of the message stays: purpose + rewards untouched.
  assert.equal(
    SURVEY_FEEDBACK_THANK_YOU_NOTE,
    "Đánh giá được dùng để cải thiện chất lượng khảo sát và điểm thưởng của bạn không bị ảnh hưởng.",
  );
  // No identity / Publisher-visibility promise until Story 9.3's privacy design is approved.
  assert.doesNotMatch(SURVEY_FEEDBACK_THANK_YOU_NOTE, /danh tính|người đăng khảo sát|ẩn danh/i);

  // The feedback panel renders the shared note and carries no inline promise of its own.
  const source = await readFile(
    new URL("../app/(signed-in)/(focus)/attempts/[id]/complete/components/FeedbackPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /SURVEY_FEEDBACK_THANK_YOU_NOTE/);
  assert.doesNotMatch(source, /danh tính|người đăng khảo sát|ẩn danh/i);
});
