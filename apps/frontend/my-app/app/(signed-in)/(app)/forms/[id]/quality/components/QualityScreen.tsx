"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { DemoDataTag } from "@/components/ui/DemoDataTag";
import { Tag } from "@/components/ui/Tag";
import { useApiQuery } from "@/lib/api/use-api-query";
import { formatDayMonth } from "@/lib/format/date-time";
import { qualityLoadErrorMessage } from "@/lib/forms/results-messages";
import {
  confidenceLabel,
  dropOffBars,
  dropOffSummary,
  QUALITY_DISCLAIMER,
  qualityTiles,
  suggestionView,
} from "@/lib/forms/results-quality";
import { getFormQuality, type FormQuality } from "@/lib/forms/results-service";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { ResultsError, ResultsLoading } from "../../responses/components/ResultsStatus";
import { DropOffChart } from "./DropOffChart";

const CARD = "rounded-[22px] border border-line bg-surface p-5 lg:p-6";

function Heading({ quality }: { quality: FormQuality }) {
  const enough = quality.status === "ENOUGH_DATA";
  const confidence = confidenceLabel(quality.confidence);
  const updated = quality.updatedAt ? ` · cập nhật ${formatDayMonth(quality.updatedAt)}` : "";
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[20px] font-extrabold text-ink">Đánh giá chất lượng · phiên bản v{quality.versionNumber}</h2>
        <Tag tone={enough ? "teal" : "neutral"} size="md" icon={enough ? <Icon name="check-circle" size={14} /> : undefined}>
          {enough ? "Đủ dữ liệu" : "Chưa đủ dữ liệu"}
        </Tag>
        <DemoDataTag />
        {confidence ? (
          <Tag tone="neutral" size="md" className="text-ink-strong">
            {confidence}
          </Tag>
        ) : null}
      </div>
      <p className="text-caption text-ink-muted">
        Dựa trên {quality.basedOnResponses} câu trả lời · chính sách {quality.policyVersion}
        {updated}
      </p>
    </div>
  );
}

function Suggestions({ quality, formId }: { quality: FormQuality; formId: string }) {
  const items = quality.suggestions.map(suggestionView);
  return (
    <section aria-labelledby="quality-suggestions" className={CARD}>
      <h3 id="quality-suggestions" className="text-[17px] font-extrabold text-ink">
        Gợi ý cải thiện
      </h3>
      {items.length ? (
        <ul className="mt-2.5">
          {items.map((item) => (
            <li key={item.title} className="flex items-start gap-3 border-t border-line-subtle py-3.5">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-subtle text-ink-strong">
                <Icon name={item.icon} size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-body font-bold text-ink">{item.title}</p>
                <p className="mt-1 text-caption leading-[19.5px] text-ink-strong">{item.body}</p>
              </div>
              {item.fixedInVersion ? (
                <Link
                  href={`/forms/${formId}/versions`}
                  className="mt-2.5 shrink-0 text-caption font-bold text-primary hover:underline"
                >
                  Sửa ở v{item.fixedInVersion}
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-body-sm text-ink-muted">
          {quality.status === "ENOUGH_DATA"
            ? "Chưa có gợi ý nào: khảo sát đang chạy tốt."
            : `Gợi ý sẽ có khi đủ ${quality.minimumResponses} câu trả lời.`}
        </p>
      )}
    </section>
  );
}

/** Figma 17 "Đánh giá chất lượng khảo sát". Mobile (not drawn): same blocks stacked, tiles 2×2. */
export function QualityScreen() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const version = Number(search.get("v")) || null;
  const query = useApiQuery(`form-quality:${id}:${version ?? ""}`, (signal) => getFormQuality(id, version, signal));
  const sessionLost = useSessionLossRedirect(query.error);
  const quality = query.data;

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12">
      {query.error && !quality && !sessionLost ? (
        <ResultsError message={qualityLoadErrorMessage(query.error)} onRetry={query.reload} />
      ) : !quality ? (
        <ResultsLoading label="Đang tải đánh giá chất lượng…" />
      ) : (
        <div className="flex flex-col gap-5">
          <Heading quality={quality} />
          {quality.status === "NOT_ENOUGH_DATA" ? (
            <p className="rounded-control bg-tone-amber-bg px-4 py-3 text-body-sm text-tone-amber-fg">
              Cần ít nhất {quality.minimumResponses} câu trả lời để đánh giá chắc chắn (hiện có{" "}
              {quality.basedOnResponses}). Các số dưới đây chỉ để tham khảo.
            </p>
          ) : null}

          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            {qualityTiles(quality).map((tile) => (
              <li key={tile.label} className="flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4 lg:p-4.5">
                <span className="text-caption font-semibold text-ink-muted">{tile.label}</span>
                <span className="text-[22px] leading-[26px] font-extrabold text-ink lg:text-[26px]">{tile.value}</span>
                <span className="text-[12px] text-ink-muted">{tile.caption}</span>
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_460px] lg:items-start">
            <section aria-labelledby="quality-drop-off" className={CARD}>
              <h3 id="quality-drop-off" className="text-[17px] font-extrabold text-ink">
                Người dừng lại ở câu nào
              </h3>
              <p className="mt-1 text-caption text-ink-muted">{dropOffSummary(quality)}</p>
              <div className="mt-4">
                {quality.dropOff.length ? (
                  <DropOffChart bars={dropOffBars(quality)} />
                ) : (
                  <p className="text-body-sm text-ink-muted">
                    {quality.formType === "EXTERNAL"
                      ? "Khảo sát làm trên Google Forms nên Rescom không biết người trả lời dừng ở câu nào."
                      : "Chưa có dữ liệu."}
                  </p>
                )}
              </div>
            </section>
            <Suggestions quality={quality} formId={id} />
          </div>

          <p className="flex items-start gap-2.5 rounded-control bg-surface-subtle px-4 py-3 text-caption leading-[19.5px] text-ink-strong">
            <Icon name="info" size={18} className="mt-px shrink-0" />
            {QUALITY_DISCLAIMER}
          </p>
        </div>
      )}
    </div>
  );
}
