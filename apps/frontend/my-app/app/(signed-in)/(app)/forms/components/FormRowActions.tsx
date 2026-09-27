import Link from "next/link";
import type { PublisherFormSummary } from "@/lib/forms/manage-service";
import { canReopen, resubmitHref, resultsHref, type PublisherStatusView } from "@/lib/forms/manage-status";

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
 */
export function FormRowActions({
  form,
  view,
  layout,
}: {
  form: PublisherFormSummary;
  view: PublisherStatusView;
  layout: Layout;
}) {
  const id = encodeURIComponent(form.id);
  switch (view) {
    case "PENDING_REVIEW":
      return layout === "row" ? <span className="text-caption text-ink-muted">Chờ Admin duyệt</span> : null;
    case "RUNNING":
    case "PAUSED":
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
          {canReopen(form) ? (
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
      // ASSUMED (not drawn): a never-submitted draft continues in its editor.
      return (
        <Action href={resubmitHref(form)} variant="secondary" layout={layout}>
          Tiếp tục soạn
        </Action>
      );
  }
}
