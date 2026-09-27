/**
 * Pure presentation rules for Figma 16b "Bảng xếp hạng" (63:3114 / 63:4078).
 * Structural types only, so node tests can import this file directly.
 */

type BoardType = "surveys" | "streak";
type BoardPeriod = "week" | "all";

interface BoardRow {
  userId: string;
  rank: number | null;
  value: number;
}

interface Board {
  type: BoardType;
  size: number;
  entries: readonly BoardRow[];
  me: BoardRow;
}

export const LEADERBOARD_TYPE_LABELS: Record<BoardType, string> = {
  surveys: "Nhiều khảo sát",
  streak: "Chuỗi dài nhất",
};

export const LEADERBOARD_PERIOD_LABELS: Record<BoardPeriod, string> = {
  week: "Tuần này",
  all: "Mọi lúc",
};

/** Unit read after the value ("23 khảo sát", "12 ngày"). */
export function valueUnit(type: BoardType): string {
  return type === "surveys" ? "khảo sát" : "ngày";
}

/** Rank badge: Figma gold #F2B705, silver #C9CFDA, bronze #E3B58A, then neutral. */
export type RankTone = "gold" | "silver" | "bronze" | "plain";

export function rankTone(rank: number): RankTone {
  if (rank === 1) return "gold";
  if (rank === 2) return "silver";
  if (rank === 3) return "bronze";
  return "plain";
}

/**
 * Figma's top-right "[PHẠM VI] top [N]" placeholder, rendered as two lines
 * (ASSUMED): the period, then the list size.
 */
export function scopeLabel(period: BoardPeriod, size: number): [string, string] {
  return [LEADERBOARD_PERIOD_LABELS[period], `top ${size}`];
}

/** The user's own row is already one of the top entries (highlight it, no pinned row). */
export function isMeInTop(board: Board): boolean {
  return board.entries.some((entry) => entry.userId === board.me.userId);
}

/**
 * Hint under "Bạn · <tên>": Figma "Thêm 7 khảo sát để vào top 10" = the last
 * top entry's value minus the user's value (reaching it ties the cut-off).
 */
export function meHint(board: Board): string {
  const unit = valueUnit(board.type);
  if (board.me.rank === null) {
    return board.type === "surveys"
      ? "Làm 1 khảo sát để có mặt trên bảng xếp hạng"
      : "Làm 1 khảo sát hôm nay để bắt đầu chuỗi";
  }
  if (board.me.rank <= board.size || isMeInTop(board)) return `Bạn đang ở top ${board.size}`;
  const cutoff = board.entries[board.entries.length - 1]?.value ?? 0;
  const gap = Math.max(cutoff - board.me.value, 1);
  return `Thêm ${gap} ${unit} để vào top ${board.size}`;
}

/** Query-string parsing for `/leaderboard?type=streak&period=all`; unknown values fall back to the Figma default. */
export function parseLeaderboardParams(params: { get(name: string): string | null }): {
  type: BoardType;
  period: BoardPeriod;
} {
  const type = params.get("type") === "streak" ? "streak" : "surveys";
  const period = params.get("period") === "all" ? "all" : "week";
  return { type, period };
}
