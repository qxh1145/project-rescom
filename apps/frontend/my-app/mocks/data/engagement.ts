import type { EngagementSummary } from "@/lib/engagement/engagement-service";
import type { Leaderboard, LeaderboardPeriod, LeaderboardType } from "@/lib/engagement/leaderboard-service";
import { mondayIndex, streakTodayKey } from "@/lib/engagement/streak-view";
import type { MockSessionUser } from "../db/session";

/**
 * Seed = Figma page 16 (55:18): streak 1 day (record 1, counted today), tier
 * "Thành viên xác thực" with 2/20 surveys, 41st this week on "Nhiều khảo sát".
 * Read-only: nothing in the mock flows writes engagement yet.
 */

const SEED = {
  current: 1,
  longest: 1,
  tierLevel: 2,
  completedSurveys: 2,
  publishedSurveys: 4,
  weeklyRank: 41,
} as const;

/**
 * `GET /engagement/me` (ASSUMED). Figma draws Saturday as both "today" and the
 * only done day; the mock marks *today* done so the week row, "Hôm nay đã
 * tính" and the CTA stay coherent on any day (identical to Figma on a Saturday).
 * A user without a completed profile is still tier 1 (level 2 needs it).
 */
export function engagementOf(user: MockSessionUser, now = new Date()): EngagementSummary {
  // The week of the Vietnamese "today" (the screen derives today the same way).
  const today = streakTodayKey(now);
  const [year, month, day] = today.split("-").map(Number);
  const todayIndex = mondayIndex(today);
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1, day - todayIndex + index));
    return { date: date.toISOString().slice(0, 10), done: index === todayIndex };
  });
  return {
    streak: { current: SEED.current, longest: SEED.longest, countedToday: true, week },
    tier: { level: user.profileComplete ? SEED.tierLevel : 1 },
    stats: { completedSurveys: SEED.completedSurveys, publishedSurveys: SEED.publishedSurveys },
    weeklyRank: SEED.weeklyRank,
  };
}

type Row = [name: string, tierLevel: number, value: number];

/** Top 10 per board. "Nhiều khảo sát · Tuần này" is the exact Figma list; the others are plausible, tier-consistent data. */
const BOARDS: Record<LeaderboardType, Record<LeaderboardPeriod, { rows: Row[]; me: { rank: number; value: number } }>> = {
  surveys: {
    week: {
      rows: [
        ["Trần Minh", 3, 23],
        ["Phạm Quân", 2, 19],
        ["Võ Hà", 3, 17],
        ["Đặng Thu", 2, 15],
        ["Lê Anh", 2, 14],
        ["Ngô Bảo", 2, 12],
        ["Mai Chi", 3, 11],
        ["Bùi Nam", 2, 10],
        ["Tạ Long", 2, 9],
        ["Phan Yến", 2, 9],
      ],
      me: { rank: SEED.weeklyRank, value: SEED.completedSurveys },
    },
    all: {
      rows: [
        ["Hồ Gia Huy", 4, 164],
        ["Trịnh Lan", 4, 131],
        ["Đinh Khánh", 4, 108],
        ["Trần Minh", 3, 86],
        ["Võ Hà", 3, 72],
        ["Lý Thảo", 3, 65],
        ["Mai Chi", 3, 54],
        ["Cao Sơn", 3, 47],
        ["Kiều Vy", 3, 39],
        ["Hà Phúc", 3, 33],
      ],
      me: { rank: 214, value: SEED.completedSurveys },
    },
  },
  streak: {
    week: {
      rows: [
        ["Mai Chi", 3, 18],
        ["Trần Minh", 3, 15],
        ["Tạ Long", 2, 12],
        ["Võ Hà", 3, 11],
        ["Phan Yến", 2, 9],
        ["Đặng Thu", 2, 8],
        ["Lê Anh", 2, 7],
        ["Bùi Nam", 2, 6],
        ["Ngô Bảo", 2, 5],
        ["Phạm Quân", 2, 5],
      ],
      me: { rank: 57, value: SEED.current },
    },
    all: {
      rows: [
        ["Hồ Gia Huy", 4, 64],
        ["Trịnh Lan", 4, 51],
        ["Mai Chi", 3, 40],
        ["Đinh Khánh", 4, 33],
        ["Trần Minh", 3, 29],
        ["Lý Thảo", 3, 24],
        ["Võ Hà", 3, 21],
        ["Cao Sơn", 3, 19],
        ["Tạ Long", 2, 17],
        ["Kiều Vy", 3, 16],
      ],
      me: { rank: 390, value: SEED.longest },
    },
  },
};

/** Stable fake ids so React keys and "is this me" checks work. */
function memberId(name: string): string {
  return `member:${name}`;
}

/** Figma numbers the rows 1…10 even when values tie ("Tạ Long 9" is 9th, "Phan Yến 9" 10th). */
function ranked(rows: Row[]) {
  return rows.map(([name, tierLevel, value], index) => ({ userId: memberId(name), rank: index + 1, name, tierLevel, value }));
}

/** `GET /engagement/leaderboard` (ASSUMED). The "Bạn" row uses the signed-in mock user's name. */
export function leaderboardOf(user: MockSessionUser, type: LeaderboardType, period: LeaderboardPeriod): Leaderboard {
  const board = BOARDS[type][period];
  const summary = engagementOf(user);
  return {
    type,
    period,
    size: board.rows.length,
    entries: ranked(board.rows),
    me: { userId: user.id, rank: board.me.rank, name: user.name, tierLevel: summary.tier.level, value: board.me.value },
  };
}
