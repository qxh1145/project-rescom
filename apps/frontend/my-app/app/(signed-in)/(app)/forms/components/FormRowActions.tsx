import Link from "next/link";
import type { PublisherFormSummary } from "@/lib/forms/manage-service";
import {
  canDelete,
  canWithdraw,
  continueDraftHref,
  listOffersReopen,
  resubmitHref,
  resultsHref,
  type PublisherStatusView,
} from "@/lib/forms/manage-status";
import { DeleteDraftAction } from "./DeleteDraftAction";
import { WithdrawAction } from "./WithdrawAction";

type Layout = "row" | "card";

const BASE = "inline-flex items-center justify-center whitespace-nowrap border font-bold transition-colors";
/** Desktop row links (Figma 63:198): 42px, 10px radius, 14px label. Mobile cards (63:1347): 46px, 12px, 15px. */
const SIZE: Record<Layout, string> = {
  row: "h-10.5 rounded-[10px] px-3.5 text-[14px]",
  card: "h-11.5 flex-1 rounded-field px-4 text-[15px]",
};
const VARIANT = {
  outline: "border-primary bg-surface text-primary hover:bg-primary/5",
  secondary: "border-line-strong bg-surface text-ink hover:bg-surface-subtle",
  danger: "border-line-strong bg-surface text-danger hover:border-danger hover:bg-danger-soft",
};

function Action({ href, variant, layout, children }: { href: string; variant: keyof typeof VARIANT; layout: Layout; children: string }) {
  return (
    <Link href={href} className={`${BASE} ${SIZE[layout]} ${VARIANT[variant]}`}>
      {children}
    </Link>
  );
}

/**
 * "Hành động" of a survey (Figma 63:127 / 63:1300): Chờ Admin duyệt · Xem tiến độ ·
 * Kết quả + Mở lại · Sửa & gửi lại. Returns null when a status has no action.
 * "Rút lại" (Phase 5 M7, ASSUMED (design) placement) withdraws a queued survey or a
 * re-versioned draft; "Mở lại" follows `listOffersReopen` (Phase 5 M2).
 * "Xoá" (ASSUMED (design) placement) deletes a never-published draft.
 */
export function FormRowActions({
  form,
  view,
  layout,
  onChanged,
}: {
  form: PublisherFormSummary;
  view: PublisherStatusView;
  layout: Layout;
  /** Reloads the list after a withdrawal. */
  onChanged: () => void;
}) {
  const id = encodeURIComponent(form.id);
  const withdraw = canWithdraw(form, form.latestVersionNumber) ? (
    <WithdrawAction
      form={form}
      label={layout === "row" ? "Rút lại" : "Rút lại & hoàn điểm"}
      className={`${BASE} ${SIZE[layout]} ${VARIANT.secondary}`}
      onWithdrawn={onChanged}
    />
  ) : null;
  switch (view) {
    case "PENDING_REVIEW":
      return layout === "row" ? (
        <>
          <span className="self-center text-caption text-ink-muted">Chờ Admin duyệt</span>
          {withdraw}
        </>
      ) : (
        withdraw
      );
    case "RUNNING":
      return (
        <Action href={`/forms/${id}`} variant="outline" layout={layout}>
          Xem tiến độ
        </Action>
      );
    case "FULL":
    case "ENDED":
      return (
        <>
          <Action href={resultsHref(form)} variant="secondary" layout={layout}>
            {layout === "row" ? "Kết quả" : "Xem kết quả"}
          </Action>
          {listOffersReopen(form) ? (
            <Action href={`/forms/${id}/reopen`} variant="outline" layout={layout}>
              {layout === "row" ? "Mở lại" : "Mở lại thêm mẫu"}
            </Action>
          ) : null}
        </>
      );
    case "REJECTED":
      return (
        <Action href={resubmitHref(form)} variant="secondary" layout={layout}>
          Sửa &amp; gửi lại
        </Action>
      );
    case "DRAFT":
      // ASSUMED (design) (not drawn): a never-submitted draft continues in its editor.
      return (
        <>
          <Action href={continueDraftHref(form)} variant="secondary" layout={layout}>
            Tiếp tục soạn
          </Action>
          {withdraw}
          {canDelete(form, form.latestVersionNumber) ? (
            <DeleteDraftAction form={form} className={`${BASE} ${SIZE[layout]} ${VARIANT.danger}`} onDeleted={onChanged} />
          ) : null}
        </>
      );
  }
}
