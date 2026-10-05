import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { PublisherForm } from "@/lib/forms/manage-service";
import { SURVEY_QUALITY_ENABLED } from "@/lib/forms/results-scope";

/** Child segment → tab. Tiến độ also stays active under its dialogs (reopen, complaints). */
export type SurveyTab = "progress" | "responses" | "quality" | "versions";

const TAB_BASE = "inline-flex h-12.75 shrink-0 items-center gap-2 border-b-3 px-4 text-body whitespace-nowrap";

function CountBadge({ value }: { value: number }) {
  return (
    <span className="inline-flex h-5.5 min-w-6 items-center justify-center rounded-full bg-surface-subtle px-2 text-[12px] font-bold text-ink">
      {value}
    </span>
  );
}

/**
 * "Nav – Các phần của khảo sát": Form Builder surveys get four tabs (Figma 17
 * 63:4735); Google Forms surveys get Tiến độ + "Câu trả lời trên Google Forms ↗"
 * (Figma 10a 62:2603) because Rescom does not store those answers.
 */
export function SurveyTabs({ form, active }: { form: PublisherForm; active: SurveyTab }) {
  const id = encodeURIComponent(form.id);
  const tabs =
    form.type === "INTERNAL"
      ? [
          { tab: "progress" as const, href: `/forms/${id}`, label: "Tiến độ", count: null },
          { tab: "responses" as const, href: `/forms/${id}/responses`, label: "Câu trả lời", count: form.completedCompletions },
          // MSW-served in the hybrid mode (Epic 10 deferred): kept reachable for internal testing.
          ...(SURVEY_QUALITY_ENABLED
            ? [{ tab: "quality" as const, href: `/forms/${id}/quality`, label: "Chất lượng", count: null }]
            : []),
          { tab: "versions" as const, href: `/forms/${id}/versions`, label: "Phiên bản", count: form.currentVersion.versionNumber },
        ]
      : [{ tab: "progress" as const, href: `/forms/${id}`, label: "Tiến độ", count: null }];
  const externalUrl = form.type === "EXTERNAL" ? form.currentVersion.externalUrl : null;

  return (
    <nav
      aria-label="Các phần của khảo sát"
      className="flex overflow-x-auto border-b border-line bg-surface max-lg:px-5 lg:bg-transparent"
    >
      {tabs.map((item) => {
        const current = item.tab === active;
        return (
          <Link
            key={item.tab}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={[
              TAB_BASE,
              form.type === "EXTERNAL" ? "max-lg:flex-1 max-lg:justify-center" : "",
              current ? "border-primary font-bold text-primary-strong" : "border-transparent font-semibold text-ink hover:text-primary",
            ].join(" ")}
          >
            {item.label}
            {item.count !== null ? <CountBadge value={item.count} /> : null}
          </Link>
        );
      })}
      {externalUrl ? (
        <a
          href={externalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${TAB_BASE} border-transparent font-semibold text-ink hover:text-primary max-lg:flex-1 max-lg:justify-center`}
        >
          Câu trả lời
          <span className="hidden text-caption font-medium text-ink-muted lg:inline">trên Google Forms</span>
          <Icon name="external-link" size={14} className="text-ink-muted" />
          <span className="sr-only">(mở Google Forms trong thẻ mới)</span>
        </a>
      ) : null}
    </nav>
  );
}
