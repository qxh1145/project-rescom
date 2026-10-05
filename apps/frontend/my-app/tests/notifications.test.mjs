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
  const { mockRepository } = await import("../mocks/legacy/repository.ts");
  const { setMockStorage, saveAttempt, getAttempt, loadStore, saveStore } = await import(
    "../mocks/legacy/store.ts"
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
