import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tag } from "@/components/ui/Tag";
import { formatDayMonth, formatShortDateTime } from "@/lib/format/date-time";
import { sourceLabel } from "@/lib/forms/manage-status";
import { daysUntil, listRowMeta } from "@/lib/forms/manage-view";
import type { MyFormRow } from "../hooks/use-my-forms";
import { FormRowActions } from "./FormRowActions";
import { StatusPill } from "./StatusPill";

function CardBody({ row, now }: { row: MyFormRow; now: number }) {
  const { form, view } = row;
  switch (view) {
    case "PENDING_REVIEW":
      return (
        <>
          <p className="mt-2 text-caption text-ink-muted">
            Gửi {formatShortDateTime(form.submittedAt ?? form.createdAt)} · {form.expectedCompletions} người ·{" "}
            {form.rewardPerResponse} điểm/lượt{form.escrowLocked !== null ? ` · ký quỹ ${form.escrowLocked}` : ""}
          </p>
          <p className="mt-4 text-caption leading-[18.9px] text-ink-strong">
            Admin sẽ duyệt trước khi khảo sát hiện trên Khám phá.
          </p>
        </>
      );
    case "RUNNING":
    case "PAUSED":
      return (
        <>
          <div className="mt-2.5 flex items-baseline justify-between gap-3 text-caption">
            <span className="font-bold text-ink">
              {form.completedCompletions}/{form.expectedCompletions} người
            </span>
            {form.escrowLocked !== null ? (
              <span className="text-ink-muted">ký quỹ còn {form.escrowLocked} điểm</span>
            ) : null}
          </div>
          <ProgressBar
            className="mt-1.5"
            value={form.completedCompletions}
            max={form.expectedCompletions}
            label={`Tiến độ ${form.completedCompletions} trên ${form.expectedCompletions}`}
          />
        </>
      );
    case "REJECTED":
      return (
        <>
          {form.rejection?.reason ? (
            <div className="mt-2.5 rounded-field bg-danger-soft px-3 py-2.5 text-caption leading-[18.9px]">
              <p className="font-bold text-danger-strong">Lý do từ Admin</p>
              <p className="mt-1 text-ink">{form.rejection.reason}</p>
            </div>
          ) : null}
          <p className="mt-2.5 text-caption font-semibold text-tone-teal-fg">
            {/* ASSUMED `rejection` may be absent (backend list DTO): the escrow is refunded either way. */}
            {form.rejection
              ? `Đã hoàn ${form.rejection.refundedPoints} điểm ký quỹ vào số dư`
              : "Ký quỹ đã được hoàn vào số dư"}
          </p>
        </>
      );
    case "DRAFT":
      return <p className="mt-2 text-caption text-ink-muted">{listRowMeta(form, now)}</p>;
    case "FULL":
    case "ENDED":
      return (
        <p className="mt-2 text-caption text-ink-muted">
          {sourceLabel(form.type)} · {form.completedCompletions}/{form.expectedCompletions} người
          {form.closedAt ? ` · kết thúc ${formatDayMonth(form.closedAt)}` : ""}
        </p>
      );
  }
}

/** Top-right note of a card: "Còn 9 ngày" (63:1341), "Đã ẩn khỏi Khám phá" (63:1354). */
function cornerNote(row: MyFormRow, now: number): string | null {
  const { form, view } = row;
  if (view === "RUNNING" || view === "PAUSED") {
    const days = daysUntil(form.deadlineAt, now);
    return days === null ? null : `Còn ${days} ngày`;
  }
  if ((view === "FULL" || view === "ENDED") && form.hiddenFromMarketplace) return "Đã ẩn khỏi Khám phá";
  return null;
}

/** Mobile list of "Khảo sát của tôi" (Figma 63:1324 …). */
export function FormCards({ rows, now, onChanged }: { rows: readonly MyFormRow[]; now: number; onChanged: () => void }) {
  return (
    <ul className="flex flex-col gap-4">
      {rows.map((row) => {
        const corner = cornerNote(row, now);
        const actions = <FormRowActions form={row.form} view={row.view} layout="card" onChanged={onChanged} />;
        return (
          <li key={row.form.id} className="rounded-[18px] border border-line bg-surface p-4">
            <div className="flex items-center gap-2">
              <StatusPill view={row.view} />
              {row.view === "PENDING_REVIEW" ? (
                <Tag tone="blue">{sourceLabel(row.form.type)}</Tag>
              ) : null}
              {corner ? <span className="ml-auto text-caption font-semibold text-ink-muted">{corner}</span> : null}
            </div>
            <h2 className="mt-2.5 text-[16px] leading-[21.6px] font-bold text-ink">{row.form.title}</h2>
            <CardBody row={row} now={now} />
            <div className="mt-3.5 flex gap-2 empty:hidden">{actions}</div>
          </li>
        );
      })}
    </ul>
  );
}
