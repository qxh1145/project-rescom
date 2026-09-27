import test from "node:test";
import assert from "node:assert/strict";

test("Figma 16: nextTierProgress reports 2/20 and 18 remaining for a level-2 member with 2 surveys", async () => {
  const { nextTierProgress, tierOf, TIERS } = await import("../lib/engagement/tiers.ts");

  const progress = nextTierProgress(2, 2);
  assert.equal(progress?.next.name, "Người đóng góp tích cực");
  assert.deepEqual(
    { current: progress?.current, target: progress?.target, remaining: progress?.remaining },
    { current: 2, target: 20, remaining: 18 },
  );

  // Past the target: current is capped, nothing remains.
  assert.deepEqual(
    (({ current, target, remaining }) => ({ current, target, remaining }))(nextTierProgress(3, 140)),
    { current: 100, target: 100, remaining: 0 },
  );
  // Level 1 → 2 needs 1 survey (+ profile).
  assert.equal(nextTierProgress(1, 0)?.target, 1);
  // Top tier: no next tier.
  assert.equal(nextTierProgress(5, 999), null);

  assert.equal(TIERS.length, 5);
  assert.equal(tierOf(2).name, "Thành viên xác thực");
  assert.equal(tierOf(42).level, 1, "unknown levels fall back to tier 1");
});

test("Figma 16a: weekDays maps done / missed / today / upcoming, Monday first", async () => {
  const { weekDays } = await import("../lib/engagement/streak-view.ts");
  const week = [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
    "2026-09-27",
  ].map((date) => ({ date, done: date === "2026-09-26" }));

  // Figma: Saturday is today and done, Sunday still to come.
  const drawn = weekDays(week, "2026-09-26");
  assert.deepEqual(
    drawn.map((day) => `${day.label}:${day.state}`),
    ["T2:missed", "T3:missed", "T4:missed", "T5:missed", "T6:missed", "T7:done", "CN:upcoming"],
  );
  assert.equal(drawn.find((day) => day.isToday)?.label, "T7");

  // A day later without a survey yet: Sunday is "today".
  assert.equal(weekDays(week, "2026-09-27")[6].state, "today");
});

test("Figma 16a: streak copy — status line and next-day CTA", async () => {
  const { formatDays, mondayIndex, nextStreakHint, streakStatusLine, streakTodayKey } = await import(
    "../lib/engagement/streak-view.ts"
  );

  assert.equal(formatDays(1), "1 ngày");
  assert.equal(streakStatusLine({ longest: 1, countedToday: true }), "Hôm nay đã tính · kỷ lục của bạn: 1 ngày");
  assert.equal(streakStatusLine({ longest: 9, countedToday: false }), "Hôm nay chưa tính · kỷ lục của bạn: 9 ngày");

  assert.equal(mondayIndex("2026-09-21"), 0);
  assert.equal(mondayIndex("2026-09-27"), 6);
  // "Today" is the Vietnamese day, whatever the device zone.
  assert.equal(streakTodayKey(new Date("2026-01-05T03:00:00.000Z")), "2026-01-05");
  assert.equal(streakTodayKey(new Date("2026-09-26T17:30:00.000Z")), "2026-09-27", "00:30 in Vietnam");
  assert.equal(streakTodayKey(new Date("2026-09-26T16:59:00.000Z")), "2026-09-26", "23:59 in Vietnam");

  // Figma: counted on Saturday → "Làm 1 khảo sát vào Chủ nhật để lên 2 ngày".
  assert.equal(
    nextStreakHint({ current: 1, countedToday: true }, "2026-09-26"),
    "Làm 1 khảo sát vào Chủ nhật để lên 2 ngày",
  );
  assert.equal(nextStreakHint({ current: 3, countedToday: true }, "2026-09-27"), "Làm 1 khảo sát vào Thứ Hai để lên 4 ngày");
  assert.equal(nextStreakHint({ current: 3, countedToday: false }, "2026-09-27"), "Làm 1 khảo sát hôm nay để lên 4 ngày");
  assert.equal(nextStreakHint({ current: 0, countedToday: false }, "2026-09-27"), "Làm 1 khảo sát hôm nay để bắt đầu chuỗi");
});

test("Figma 16b: leaderboard view — rank tones, scope label, 'Bạn' hint", async () => {
  const { isMeInTop, meHint, parseLeaderboardParams, rankTone, scopeLabel } = await import(
    "../lib/engagement/leaderboard-view.ts"
  );

  assert.deepEqual([1, 2, 3, 4, 10].map(rankTone), ["gold", "silver", "bronze", "plain", "plain"]);
  assert.deepEqual(scopeLabel("week", 10), ["Tuần này", "top 10"]);
  assert.deepEqual(scopeLabel("all", 10), ["Mọi lúc", "top 10"]);

  const values = [23, 19, 17, 15, 14, 12, 11, 10, 9, 9];
  const board = {
    type: "surveys",
    size: 10,
    entries: values.map((value, index) => ({ userId: `u${index}`, rank: index + 1, value })),
    me: { userId: "me", rank: 41, value: 2 },
  };
  assert.equal(meHint(board), "Thêm 7 khảo sát để vào top 10");
  assert.equal(isMeInTop(board), false);

  assert.equal(
    meHint({ ...board, type: "streak", me: { userId: "me", rank: 57, value: 1 } }),
    "Thêm 8 ngày để vào top 10",
  );
  assert.equal(meHint({ ...board, me: { userId: "me", rank: 50, value: 9 } }), "Thêm 1 khảo sát để vào top 10");
  assert.equal(meHint({ ...board, me: { userId: "me", rank: null, value: 0 } }), "Làm 1 khảo sát để có mặt trên bảng xếp hạng");

  const inTop = { ...board, me: { userId: "u2", rank: 3, value: 17 } };
  assert.equal(isMeInTop(inTop), true);
  assert.equal(meHint(inTop), "Bạn đang ở top 10");

  const params = (query) => new URLSearchParams(query);
  assert.deepEqual(parseLeaderboardParams(params("")), { type: "surveys", period: "week" });
  assert.deepEqual(parseLeaderboardParams(params("type=streak&period=all")), { type: "streak", period: "all" });
  assert.deepEqual(parseLeaderboardParams(params("type=bogus&period=year")), { type: "surveys", period: "week" });
});
