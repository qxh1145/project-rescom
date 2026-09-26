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

test("Story 9.6: mock notification center", async (t) => {
  const { notificationListSchema } = await import("@rescom/schemas");
  const { mockRepository } = await import("../lib/mock/repository.ts");
  const { setMockStorage, saveAttempt, getAttempt, loadStore, saveStore } = await import(
    "../lib/mock/store.ts"
  );

  t.beforeEach(() => {
    setMockStorage(createMockStorage());
    mockRepository.setLatency(0);
    mockRepository.setSimulateError(false);
  });

  await t.test("new persona starts with an empty notification list", async () => {
    await mockRepository.switchDemoUser("user-new-001");
    const list = await mockRepository.getNotifications();
    assert.deepEqual(list, {
      items: [],
      unreadCount: 0,
      total: 0,
      limit: 20,
      offset: 0,
      hasMore: false,
    });
    assert.equal(await mockRepository.getUnreadNotificationCount(), 0);
  });

  await t.test("activated persona has seeded notifications, newest first", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const list = await mockRepository.getNotifications();
    assert.equal(list.total, 2);
    assert.equal(list.unreadCount, 1);
    assert.deepEqual(
      list.items.map((n) => n.type),
      ["REWARD_PENDING", "ACCOUNT_ACTIVATED"],
    );
    assert.equal(list.items[0].isRead, false);
    assert.equal(list.items[1].isRead, true);
    // Same contract as the live API, so the later swap needs no mapping.
    assert.equal(notificationListSchema.safeParse(list).success, true);
    // Live-API DTO shape: no owner or dedupe internals leak to the UI.
    assert.deepEqual(Object.keys(list.items[0]).sort(), [
      "createdAt",
      "id",
      "isRead",
      "message",
      "readAt",
      "type",
    ]);
  });

  await t.test("unreadOnly filter and limit/offset paging", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const unread = await mockRepository.getNotifications({ unreadOnly: true });
    assert.equal(unread.items.length, 1);
    assert.equal(unread.total, 1);
    assert.equal(unread.unreadCount, 1);

    const firstPage = await mockRepository.getNotifications({ limit: 1 });
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.hasMore, true);
    const secondPage = await mockRepository.getNotifications({ limit: 1, offset: 1 });
    assert.equal(secondPage.items[0].type, "ACCOUNT_ACTIVATED");
    assert.equal(secondPage.hasMore, false);

    await assert.rejects(
      () => mockRepository.getNotifications({ limit: 0 }),
      (err) => err.code === "VALIDATION_ERROR",
    );
  });

  await t.test("marks one notification read and is idempotent", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const [unread] = (await mockRepository.getNotifications({ unreadOnly: true })).items;

    const first = await mockRepository.markNotificationRead(unread.id);
    assert.equal(first.notification.isRead, true);
    assert.ok(first.notification.readAt);
    assert.equal(first.unreadCount, 0);

    const again = await mockRepository.markNotificationRead(unread.id);
    assert.equal(again.notification.readAt, first.notification.readAt);
    assert.equal(await mockRepository.getUnreadNotificationCount(), 0);
  });

  await t.test("cannot read or modify another user's notifications", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const [theirs] = (await mockRepository.getNotifications({ unreadOnly: true })).items;

    await mockRepository.switchDemoUser("user-new-001");
    await assert.rejects(
      () => mockRepository.markNotificationRead(theirs.id),
      (err) => err.code === "NOTIFICATION_NOT_FOUND",
    );
    await assert.rejects(
      () => mockRepository.markNotificationRead("does-not-exist"),
      (err) => err.code === "NOTIFICATION_NOT_FOUND",
    );

    await mockRepository.switchDemoUser("user-active-002");
    assert.equal(await mockRepository.getUnreadNotificationCount(), 1);
  });

  await t.test("mark all read only touches the current user", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    const result = await mockRepository.markAllNotificationsRead();
    assert.deepEqual(result, { updatedCount: 1, unreadCount: 0 });
    assert.deepEqual(await mockRepository.markAllNotificationsRead(), {
      updatedCount: 0,
      unreadCount: 0,
    });
  });

  await t.test("requires a signed-in user", async () => {
    await mockRepository.logout();
    await assert.rejects(() => mockRepository.getNotifications(), /đăng nhập/);
  });

  await t.test("tolerates persisted stores created before notifications existed", async () => {
    const state = loadStore();
    delete state.notifications;
    saveStore(state);
    await mockRepository.switchDemoUser("user-active-002");
    const list = await mockRepository.getNotifications();
    assert.equal(list.total, 0);
  });

  await t.test(
    "starter unlock and External pending credit each notify exactly once",
    async () => {
      await mockRepository.register({
        email: "notify.student@fpt.edu.vn",
        password: "Password123!",
        name: "Người Nhận Thông Báo",
      });
      // Story 7.1: the Marketplace requires every FR-6 demographic field.
      await mockRepository.saveDemographicProfile({
        age: 21,
        gender: "FEMALE",
        location: "Hà Nội",
        occupation: "Sinh viên đại học",
        fieldOfStudy: "Công nghệ thông tin",
        householdIncome: "Dưới 5 triệu VNĐ/tháng",
        specificInterests: ["Du lịch & Ẩm thực"],
      });
      assert.equal(await mockRepository.getUnreadNotificationCount(), 0);

      const feed = await mockRepository.getMarketplaceFeed({ type: "EXTERNAL" });
      const external = feed.surveys[0];
      assert.ok(external, "an External survey is available");
      const survey = await mockRepository.getSurveyById(external.id);
      const attempt = await mockRepository.startSurveyAttempt(external.id);
      saveAttempt({
        ...attempt,
        startedAt: new Date(Date.now() - (survey.minTimeBarrierSeconds + 5) * 1000).toISOString(),
      });

      const result = await mockRepository.submitExternalSurvey(
        attempt.attemptId,
        survey.completionCode,
      );
      // Story 7.2: an External completion activates only after its 48-hour review.
      assert.equal(result.unlockedStarterPoints, false);
      let list = await mockRepository.getNotifications();
      assert.deepEqual(
        list.items.map((n) => n.type),
        ["REWARD_PENDING"],
      );

      // The review window closes; the next activation check unlocks exactly once.
      saveAttempt({
        ...getAttempt(attempt.attemptId),
        completedAt: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
      });
      await mockRepository.getActivationStatus();
      await mockRepository.getActivationStatus();

      list = await mockRepository.getNotifications();
      assert.deepEqual(
        list.items.map((n) => n.type),
        ["ACCOUNT_ACTIVATED", "REWARD_PENDING"],
      );
      assert.equal(list.unreadCount, 2);
      assert.match(list.items[1].message, new RegExp(`${survey.rewardPerResponse}`));
      assert.equal(notificationListSchema.safeParse(list).success, true);

    },
  );

  await t.test(
    "decision E9-D2: an Internal instant credit notifies REWARD_EARNED once with the full reward",
    async () => {
      await mockRepository.register({
        email: "earned.student@fpt.edu.vn",
        password: "Password123!",
        name: "Người Nhận Điểm",
      });
      await mockRepository.saveDemographicProfile({
        age: 22,
        gender: "MALE",
        location: "Đà Nẵng",
        occupation: "Sinh viên đại học",
        fieldOfStudy: "Kinh tế",
        householdIncome: "Dưới 5 triệu VNĐ/tháng",
        specificInterests: ["Công nghệ"],
      });

      const internalFeed = await mockRepository.getMarketplaceFeed({ type: "INTERNAL" });
      const paid = internalFeed.surveys.find((s) => s.rewardPerResponse > 0);
      assert.ok(paid, "a paid Internal survey is available");
      const attempt = await mockRepository.startSurveyAttempt(paid.id);
      // Story 8.2: pass the Time Barrier without sleeping.
      saveAttempt({
        ...attempt,
        startedAt: new Date(Date.now() - (attempt.minTimeBarrierSeconds + 5) * 1000).toISOString(),
      });

      const result = await mockRepository.submitInternalSurvey(attempt.attemptId, {});
      assert.equal(result.rewardEarned, paid.rewardPerResponse);

      let list = await mockRepository.getNotifications();
      const earned = list.items.filter((n) => n.type === "REWARD_EARNED");
      assert.equal(earned.length, 1);
      assert.equal(earned[0].isRead, false);
      assert.match(earned[0].message, new RegExp(`^\\+${paid.rewardPerResponse} điểm`));
      assert.match(earned[0].message, /Khả dụng/);
      assert.equal(notificationListSchema.safeParse(list).success, true);

      // A second submit of the same attempt is refused and notifies nothing.
      await assert.rejects(() => mockRepository.submitInternalSurvey(attempt.attemptId, {}));
      list = await mockRepository.getNotifications();
      assert.equal(list.items.filter((n) => n.type === "REWARD_EARNED").length, 1);
    },
  );

  await t.test("reset restores seeded notifications", async () => {
    await mockRepository.switchDemoUser("user-active-002");
    await mockRepository.markAllNotificationsRead();
    await mockRepository.resetDemo();
    await mockRepository.switchDemoUser("user-active-002");
    assert.equal(await mockRepository.getUnreadNotificationCount(), 1);
  });
});

test("Story 9.6: notifications live API client", async (t) => {
  const originalFetch = globalThis.fetch;
  const api = await import("../app/notifications/notifications-api.ts");
  const dto = {
    id: "11111111-1111-4111-8111-111111111111",
    type: "REWARD_RELEASED",
    message: "+20 points released.",
    isRead: false,
    createdAt: "2026-09-26T09:00:00.000Z",
    readAt: null,
  };
  const calls = [];

  function respond(status, body) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      clone() {
        return this;
      },
    };
  }

  function installFetch(handler) {
    calls.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/auth/csrf") {
        return respond(200, { data: { csrfToken: "csrf-token-1" } });
      }
      return handler(String(url), init);
    };
  }

  try {
    await t.test("fetchNotifications sends the validated query and parses the list", async () => {
      const list = {
        items: [dto],
        unreadCount: 1,
        total: 1,
        limit: 5,
        offset: 0,
        hasMore: false,
      };
      installFetch(() => respond(200, { data: list }));

      const result = await api.fetchNotifications({ limit: 5, unreadOnly: true });

      assert.deepEqual(result, list);
      assert.equal(calls[0].url, "/api/notifications?limit=5&offset=0&unreadOnly=true");
      assert.equal(calls[0].init.method ?? "GET", "GET");
    });

    await t.test("fetchNotifications rejects an invalid query before calling the API", async () => {
      installFetch(() => respond(200, {}));
      await assert.rejects(() => api.fetchNotifications({ limit: 500 }));
      assert.equal(calls.length, 0);
    });

    await t.test("fetchUnreadNotificationCount returns the badge number", async () => {
      installFetch(() => respond(200, { data: { unreadCount: 7 } }));
      assert.equal(await api.fetchUnreadNotificationCount(), 7);
      assert.equal(calls[0].url, "/api/notifications/unread-count");
    });

    await t.test("markNotificationRead sends a CSRF-protected PATCH", async () => {
      const readDto = { ...dto, isRead: true, readAt: "2026-09-26T09:05:00.000Z" };
      installFetch(() => respond(200, { data: { notification: readDto, unreadCount: 0 } }));

      const result = await api.markNotificationRead(dto.id);

      assert.deepEqual(result, { notification: readDto, unreadCount: 0 });
      const patch = calls.find((c) => c.url === `/api/notifications/${dto.id}/read`);
      assert.equal(patch.init.method, "PATCH");
      assert.equal(new Headers(patch.init.headers).get("X-CSRF-Token"), "csrf-token-1");
    });

    await t.test("markAllNotificationsRead parses the result", async () => {
      installFetch(() => respond(200, { data: { updatedCount: 3, unreadCount: 0 } }));
      assert.deepEqual(await api.markAllNotificationsRead(), {
        updatedCount: 3,
        unreadCount: 0,
      });
      assert.ok(calls.some((c) => c.url === "/api/notifications/read-all"));
    });

    await t.test("surfaces API error code and message", async () => {
      installFetch(() =>
        respond(404, {
          data: null,
          error: { code: "NOTIFICATION_NOT_FOUND", message: "Notification not found." },
        }),
      );
      await assert.rejects(
        () => api.markNotificationRead(dto.id),
        (err) => err.code === "NOTIFICATION_NOT_FOUND" && err.status === 404,
      );
    });

    await t.test("gives a friendly message on 401", async () => {
      installFetch(() => respond(401, { error: { code: "AUTH_INVALID_CREDENTIALS" } }));
      await assert.rejects(() => api.fetchNotifications(), /đăng nhập/);
    });

    await t.test("maps a 401 to AUTH_REQUIRED whatever the backend code", async () => {
      installFetch(() =>
        respond(401, { data: null, error: { code: "AUTH_SESSION_EXPIRED", message: "Expired." } }),
      );
      await assert.rejects(
        () => api.fetchUnreadNotificationCount(),
        (err) =>
          err.code === "AUTH_REQUIRED" &&
          err.status === 401 &&
          err.message === "Vui lòng đăng nhập để xem thông báo.",
      );
    });

    await t.test("rejects malformed payloads", async () => {
      installFetch(() => respond(200, { data: { items: "nope" } }));
      await assert.rejects(() => api.fetchNotifications(), /không hợp lệ/);
    });

    await t.test("skips an unknown-type item instead of rejecting the list", async () => {
      const unknown = {
        ...dto,
        id: "22222222-2222-4222-8222-222222222222",
        type: "POINTS_EARNED",
      };
      const list = {
        items: [unknown, dto],
        unreadCount: 2,
        total: 2,
        limit: 20,
        offset: 0,
        hasMore: false,
      };
      installFetch(() => respond(200, { data: list }));

      const result = await api.fetchNotifications();

      // The skipped row still counts: the badge stays authoritative.
      assert.deepEqual(result, { ...list, items: [dto] });
    });

    await t.test("still rejects an invalid list envelope", async () => {
      installFetch(() =>
        respond(200, {
          data: { items: [dto], unreadCount: -1, total: 1, limit: 20, offset: 0, hasMore: false },
        }),
      );
      await assert.rejects(() => api.fetchNotifications(), /không hợp lệ/);

      installFetch(() => respond(200, { data: null }));
      await assert.rejects(() => api.fetchNotifications(), /không hợp lệ/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Story 9.6: notification presentation", async () => {
  const { NOTIFICATION_TYPES } = await import("@rescom/schemas");
  const { FALLBACK_PRESENTATION, NOTIFICATION_TYPE_PRESENTATION, getNotificationPresentation } =
    await import("../lib/notification-presentation.ts");

  // Every shared type has its own entry, and nothing else is mapped.
  assert.deepEqual(Object.keys(NOTIFICATION_TYPE_PRESENTATION).sort(), [...NOTIFICATION_TYPES].sort());
  for (const type of NOTIFICATION_TYPES) {
    const presentation = getNotificationPresentation(type);
    assert.notEqual(presentation, FALLBACK_PRESENTATION, type);
    assert.ok(presentation.title && presentation.icon && presentation.iconClass, type);
  }

  // Decision E9-D2: "Points earned" has its own Vietnamese title and opens the wallet.
  assert.deepEqual(getNotificationPresentation("REWARD_EARNED"), {
    title: "Bạn đã nhận điểm thưởng",
    icon: "💰",
    iconClass: "bg-emerald-50 dark:bg-emerald-950/50",
    href: "/wallet",
  });

  // A type the frontend does not know yet renders neutrally and links nowhere.
  for (const type of ["POINTS_EARNED", "toString", ""]) {
    assert.deepEqual(getNotificationPresentation(type), {
      title: "Thông báo",
      icon: "🔔",
      iconClass: "bg-slate-100 dark:bg-slate-800",
    });
    assert.equal(getNotificationPresentation(type).href, undefined);
  }
});
