"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconLink } from "@/components/ui/IconButton";
import { REVIEW_DISCLAIMER, reviewReasonText } from "@/lib/forms/results-messages";
import type { FormResponse, FormResponses, ResultQuestion } from "@/lib/forms/results-service";
import {
  formatDurationLong,
  formatSubmittedAt,
  responseLabel,
  responseSummary,
  type ResponsePosition,
} from "@/lib/forms/results-view";
import { ComplaintLink, ResponseAnswers, ResponseMeta } from "./ResponseAnswers";
import { QualityTag } from "./QualityTag";

/** Mobile card list of 10d (63:4567…): code + quality, time line, 3-answer summary. */
export function ResponseCards({
  data,
  responses,
  columns,
  hrefFor,
  visible,
  onShowMore,
}: {
  data: FormResponses;
  responses: FormResponse[];
  columns: ResultQuestion[];
  hrefFor: (response: FormResponse) => string;
  visible: number;
  onShowMore: () => void;
}) {
  const shown = responses.slice(0, visible);
  const rest = responses.length - shown.length;
  const external = data.form.type === "EXTERNAL";
  return (
    <div className="flex flex-col gap-2.5">
      <ul className="flex flex-col gap-2.5">
        {shown.map((response) => {
          const reasons =
            response.quality === "NEEDS_REVIEW" ? response.reviewReasons.map(reviewReasonText).join(", ") : "";
          return (
            <li key={response.id}>
              <Link
                href={hrefFor(response)}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 hover:bg-surface-muted"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-extrabold text-ink">{responseLabel(response)}</span>
                    <QualityTag quality={response.quality} />
                  </div>
                  <p className="text-[12px] text-ink-muted">
                    {formatSubmittedAt(response.submittedAt)} · {formatDurationLong(response.durationSeconds)}
                    {reasons ? ` · ${reasons}` : ""}
                  </p>
                  <p className="truncate text-body-sm text-ink">
                    {external
                      ? response.codeVerified
                        ? "Mã hoàn thành đã xác minh"
                        : "Mã hoàn thành chưa xác minh"
                      : responseSummary(response, columns)}
                  </p>
                </div>
                <Icon name="chevron-right" size={20} className="text-ink-muted" />
              </Link>
            </li>
          );
        })}
      </ul>
      {rest > 0 ? (
        <Button variant="secondary" size="base" radius="field" fullWidth onClick={onShowMore}>
          Xem thêm {rest} câu trả lời
        </Button>
      ) : null}
      <p className="text-[12px] leading-[18px] text-ink-muted">{REVIEW_DISCLAIMER}</p>
    </div>
  );
}

function SwitchLink({ response, href, direction }: { response: FormResponse | null; href: string | null; direction: "previous" | "next" }) {
  const label = direction === "previous" ? "Câu trả lời trước" : "Câu trả lời sau";
  const content =
    direction === "previous" ? (
      <>
        <Icon name="chevron-left" size={18} />
        {response ? responseLabel(response) : "Đầu danh sách"}
      </>
    ) : (
      <>
        {response ? responseLabel(response) : "Cuối danh sách"}
        <Icon name="chevron-right" size={18} />
      </>
    );
  const classes = "flex h-13.5 flex-1 items-center justify-center gap-1.5 rounded-control border text-body font-bold";
  if (!response || !href) {
    return (
      <span aria-disabled="true" className={`${classes} border-line bg-disabled text-ink-muted`}>
        {content}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={`${label} ${responseLabel(response)}`} className={`${classes} border-line-strong text-ink hover:bg-surface-subtle`}>
      {content}
    </Link>
  );
}

/** 10d' mobile (63:2033): back bar, meta card, answers card, previous/next bar. */
export function ResponseDetailMobile({
  data,
  response,
  position,
  listHref,
  hrefFor,
  formId,
}: {
  data: FormResponses;
  response: FormResponse;
  position: ResponsePosition;
  listHref: string;
  hrefFor: (response: FormResponse) => string;
  formId: string;
}) {
  return (
    <div className="lg:hidden">
      {/* Not sticky: the survey header of `forms/[id]/layout.tsx` already sticks on top. */}
      <div className="flex items-center gap-3 border-b border-line bg-surface px-5 py-3">
        <IconLink href={listHref} icon="chevron-left" label="Quay lại danh sách câu trả lời" />
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-extrabold text-ink">Câu trả lời {responseLabel(response)}</h2>
          <p className="truncate text-[12px] text-ink-muted">
            {position.index} / {position.total} · {data.form.title}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-4">
        <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
          <ResponseMeta response={response} variant="page" />
        </div>
        <section aria-label="Nội dung câu trả lời" className="rounded-[18px] border border-line bg-surface p-4">
          <ResponseAnswers data={data} response={response} variant="page" />
        </section>
        <ComplaintLink formId={formId} response={response} />
      </div>
      <nav
        aria-label="Chuyển câu trả lời"
        className="sticky bottom-[calc(62px+env(safe-area-inset-bottom))] flex gap-3 border-t border-line bg-surface px-5 py-3"
      >
        <SwitchLink
          direction="previous"
          response={position.previous}
          href={position.previous ? hrefFor(position.previous) : null}
        />
        <SwitchLink direction="next" response={position.next} href={position.next ? hrefFor(position.next) : null} />
      </nav>
    </div>
  );
}

