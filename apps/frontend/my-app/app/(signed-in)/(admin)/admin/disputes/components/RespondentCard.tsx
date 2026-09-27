import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import type { DisputeCase } from "@/lib/admin/disputes-service";
import { FRAUD_LOG_LABELS, hiddenFraudLogCount, respondentSummary, sideNoteOf } from "@/lib/admin/disputes-view";
import { formatShortDateTime } from "@/lib/format/date-time";

/**
 * Right column of Figma 11c: respondent card (62:1695, 448px) + note (62:1714).
 * Links: `/admin/fraud-log?userId=` (pre-filters the log) and
 * `/admin/users?id=` (opens that user's detail panel).
 */
export function RespondentCard({ item }: { item: DisputeCase }) {
  const { respondent } = item;
  const hidden = hiddenFraudLogCount(respondent);
  const titleId = `respondent-${item.id}`;
  const userId = encodeURIComponent(respondent.id);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby={titleId} className="rounded-[22px] border border-line bg-surface px-5.5 pt-5.5 pb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id={titleId} className="text-[16px] font-extrabold text-ink">
            Người dùng {respondent.code}
          </h2>
          {respondent.repeatOffender ? (
            <Tag tone="danger" className="text-danger-strong">
              Vi phạm lặp lại
            </Tag>
          ) : null}
        </div>
        <p className="mt-2.5 text-caption text-ink-muted">{respondentSummary(respondent)}</p>
        {respondent.fraudLogCount > 0 ? (
          <ul aria-label="FraudLog gần đây" className="mt-3 text-caption">
            {respondent.recentFraudLogs.map((entry) => (
              <li key={entry.id} className="flex h-8.25 items-center justify-between gap-3 border-t border-line-subtle">
                <span className="text-ink">{FRAUD_LOG_LABELS[entry.type]}</span>
                <time dateTime={entry.createdAt} className="text-ink-muted">
                  {formatShortDateTime(entry.createdAt)}
                </time>
              </li>
            ))}
            <li className="flex h-8.25 items-center justify-between gap-3 border-t border-line-subtle">
              <span className="text-ink">{hidden > 0 ? `+${hidden} mục khác` : ""}</span>
              <Link href={`/admin/fraud-log?userId=${userId}`} className="font-bold text-primary hover:underline">
                Xem FraudLog
              </Link>
            </li>
          </ul>
        ) : null}
        <Link
          href={`/admin/users?id=${userId}`}
          className="mt-3 flex h-11.5 items-center justify-center rounded-field border border-danger px-4 text-body font-bold text-danger hover:bg-danger-soft"
        >
          Xem hồ sơ &amp; khoá tài khoản…
        </Link>
      </section>
      <div className="flex gap-2.5 rounded-control bg-surface-subtle px-3.5 py-3">
        <Icon name="info" size={18} className="mt-0.5 shrink-0 text-ink-muted" />
        <p className="text-caption-relaxed text-ink">{sideNoteOf(item.kind)}</p>
      </div>
    </div>
  );
}
