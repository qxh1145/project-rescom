import { initialsOf } from "@/components/ui/Avatar";
import type { Leaderboard, LeaderboardRow } from "@/lib/engagement/leaderboard-service";
import { isMeInTop, meHint, rankTone, valueUnit, type RankTone } from "@/lib/engagement/leaderboard-view";
import { tierOf } from "@/lib/engagement/tiers";

const RANK_TONE: Record<RankTone, string> = {
  gold: "bg-rating text-ink",
  silver: "bg-medal-silver text-ink",
  bronze: "bg-medal-bronze text-ink",
  plain: "bg-surface-subtle text-ink-strong",
};

function RankBadge({ rank, me = false }: { rank: number | null; me?: boolean }) {
  return (
    <span
      className={[
        "flex size-7.5 shrink-0 items-center justify-center rounded-full font-extrabold",
        me ? "bg-primary text-[12px] text-primary-foreground" : `text-caption ${RANK_TONE[rankTone(rank ?? 0)]}`,
      ].join(" ")}
    >
      <span className="sr-only">Hạng </span>
      {rank ?? "–"}
    </span>
  );
}

/** 38px initials disc: members on #EAF6E8, the user on brand green (Figma 63:3148 / 63:3228). */
function Initials({ name, me = false }: { name: string; me?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex size-9.5 shrink-0 items-center justify-center rounded-full text-caption font-extrabold ${
        me ? "bg-brand text-ink" : "bg-tone-green-bg text-tone-green-fg"
      }`}
    >
      {initialsOf(name)}
    </span>
  );
}

function Value({ value, unit }: { value: number; unit: string }) {
  return (
    <span className="shrink-0 text-body font-extrabold text-ink">
      {value}
      <span className="sr-only"> {unit}</span>
    </span>
  );
}

/** Row "Li" (63:3145): 58px + 1px #EEF1F6 separator; the user's own row is tinted when it is in the top list. */
function MemberRow({ row, unit, isMe }: { row: LeaderboardRow; unit: string; isMe: boolean }) {
  return (
    <li
      aria-current={isMe ? "true" : undefined}
      className={`flex h-[59px] items-center gap-3 border-b border-line-subtle pl-4 pr-4 lg:pr-6 ${isMe ? "bg-tone-green-bg" : ""}`}
    >
      <RankBadge rank={row.rank} />
      <Initials name={row.name} me={isMe} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-body text-ink ${isMe ? "font-extrabold" : "font-bold"}`}>
          {isMe ? `Bạn · ${row.name}` : row.name}
        </p>
        <p className="truncate text-[12px] text-ink-muted">{tierOf(row.tierLevel).name}</p>
      </div>
      <Value value={row.value} unit={unit} />
    </li>
  );
}

/**
 * "Li – Vị trí của bạn" (63:3225 / 63:4176): 2px primary top border on
 * #EAF6E8. Mobile keeps it stuck above the bottom nav while the list scrolls.
 */
function MyPositionRow({ board }: { board: Leaderboard }) {
  const { me } = board;
  return (
    <div
      aria-label="Vị trí của bạn"
      role="group"
      className="sticky bottom-[calc(62px+env(safe-area-inset-bottom))] z-10 flex h-16 items-center gap-3 border-t-2 border-primary bg-tone-green-bg pl-4 pr-4 lg:static lg:pr-6"
    >
      <RankBadge rank={me.rank} me />
      <Initials name={me.name} me />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body font-extrabold text-ink">Bạn · {me.name}</p>
        <p className="truncate text-[12px] text-tone-green-fg">{meHint(board)}</p>
      </div>
      <Value value={me.value} unit={valueUnit(board.type)} />
    </div>
  );
}

export function LeaderboardRows({ board, emptyMessage }: { board: Leaderboard; emptyMessage: string }) {
  const unit = valueUnit(board.type);
  const meInTop = isMeInTop(board);
  return (
    <>
      {board.entries.length === 0 ? (
        <p className="px-4 py-10 text-center text-body-sm text-ink-muted lg:px-6">{emptyMessage}</p>
      ) : (
        <ol>
          {board.entries.map((row) => (
            <MemberRow key={row.userId} row={row} unit={unit} isMe={row.userId === board.me.userId} />
          ))}
        </ol>
      )}
      {meInTop ? null : <MyPositionRow board={board} />}
    </>
  );
}
