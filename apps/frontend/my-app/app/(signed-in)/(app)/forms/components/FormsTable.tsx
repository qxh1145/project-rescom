import { ProgressBar } from "@/components/ui/ProgressBar";
import { listRowMeta } from "@/lib/forms/manage-view";
import type { MyFormRow } from "../hooks/use-my-forms";
import { FormRowActions } from "./FormRowActions";
import { StatusPill } from "./StatusPill";

/** Figma 63:169 column widths (1294px): Khảo sát · Trạng thái · Tiến độ · Điểm/lượt · Hành động. */
const GRID = "grid grid-cols-[394fr_205fr_268fr_150fr_277fr] items-center";

function ProgressCell({ row }: { row: MyFormRow }) {
  const { form, view } = row;
  switch (view) {
    case "PENDING_REVIEW":
      return (
        <p className="text-body-sm text-ink-muted">
          {form.completedCompletions}/{form.expectedCompletions} · ký quỹ {form.escrowLocked}
        </p>
      );
    case "RUNNING":
    case "PAUSED":
      return (
        <div className="flex max-w-[252px] flex-col gap-2">
          <p className="text-body-sm font-bold text-ink">
            {form.completedCompletions}/{form.expectedCompletions}
          </p>
          <ProgressBar
            value={form.completedCompletions}
            max={form.expectedCompletions}
            height={6}
            label={`Tiến độ ${form.completedCompletions} trên ${form.expectedCompletions}`}
          />
        </div>
      );
    case "REJECTED":
      return (
        <p className="text-body-sm font-semibold text-tone-teal-fg">
          Đã hoàn {form.rejection?.refundedPoints ?? 0} điểm
        </p>
      );
    default:
      return (
        <p className="text-body-sm font-bold text-ink">
          {form.completedCompletions}/{form.expectedCompletions}
        </p>
      );
  }
}

/** Figma 63:214 reads "Lý do: form yêu cầu…" (the mobile box keeps the capital). */
function lowerFirst(text: string): string {
  return text.charAt(0).toLocaleLowerCase("vi-VN") + text.slice(1);
}

/** Desktop table of "Khảo sát của tôi" (Figma 63:162). */
export function FormsTable({ rows, now }: { rows: readonly MyFormRow[]; now: number }) {
  return (
    <div role="table" aria-label="Khảo sát của tôi" className="mt-4">
      <div role="row" className={`${GRID} border-b border-line pb-2 text-caption font-semibold text-ink-muted`}>
        <span role="columnheader">Khảo sát</span>
        <span role="columnheader">Trạng thái</span>
        <span role="columnheader">Tiến độ</span>
        <span role="columnheader">Điểm/lượt</span>
        <span role="columnheader" className="text-right">
          Hành động
        </span>
      </div>
      {rows.map((row) => (
        <div role="row" key={row.form.id} className={`${GRID} min-h-17.5 gap-y-1 border-b border-line-subtle py-3 last:border-b-0`}>
          <div role="cell" className="min-w-0 pr-4">
            <p className="truncate text-body font-bold text-ink">{row.form.title}</p>
            {row.view === "REJECTED" ? (
              <p className="mt-1 text-caption leading-[18.9px] text-danger-strong">
                Lý do: {lowerFirst(row.form.rejection?.reason ?? "")}
              </p>
            ) : (
              <p className="mt-1 truncate text-caption text-ink-muted">{listRowMeta(row.form, now)}</p>
            )}
          </div>
          <div role="cell">
            <StatusPill view={row.view} />
          </div>
          <div role="cell" className="pr-4">
            <ProgressCell row={row} />
          </div>
          <div role="cell" className="text-body-sm font-bold text-ink">
            {row.form.rewardPerResponse}
          </div>
          <div role="cell" className="flex justify-end gap-2">
            <FormRowActions form={row.form} view={row.view} layout="row" />
          </div>
        </div>
      ))}
    </div>
  );
}
