"use client";

import Link from "next/link";
import { useState } from "react";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsSkeleton";
import { QuestionAnalyticsCard } from "@/components/analytics/QuestionAnalyticsCard";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { copyTextToClipboard } from "@/lib/clipboard";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { statusViewOf } from "@/lib/forms/manage-status";
import {
  analyticsLoadErrorMessage,
  GOOGLE_FORMS_ANSWERS_NOTE,
  SURVEY_LINK_COPIED,
  SURVEY_LINK_COPY_FAILED,
} from "@/lib/forms/results-messages";
import { consentPath } from "@/lib/participation/start-flow";
import { useAnalytics } from "../hooks/analytics-context";
import { AnalyticsHeader } from "./AnalyticsHeader";
import { ResultsEmpty, ResultsError } from "./ResultsStatus";

const PAGE = "mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12";

/**
 * "Sao chép liên kết khảo sát" of the empty state. ASSUMED: the shared link is
 * the respondent entry `/surveys/:id/start` (`consentPath`); when the copy
 * fails the link is shown to copy by hand.
 */
function CopySurveyLink({ formId }: { formId: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [url, setUrl] = useState("");

  const copy = async () => {
    const link = `${window.location.origin}${consentPath(formId)}`;
    setUrl(link);
    setStatus((await copyTextToClipboard(link)) ? "copied" : "failed");
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <Button variant="secondary" size="md" radius="field" leadingIcon={<Icon name="copy" size={18} />} onClick={() => void copy()}>
        Sao chép liên kết khảo sát
      </Button>
      <p role="status" className="text-caption text-ink-muted">
        {status === "copied" ? SURVEY_LINK_COPIED : status === "failed" ? SURVEY_LINK_COPY_FAILED : null}
      </p>
      {status === "failed" ? <p className="text-caption font-semibold break-all text-ink select-all">{url}</p> : null}
    </div>
  );
}

/**
 * Câu trả lời → Tóm tắt: header metrics, then one chart card per question
 * (`QuestionAnalyticsCard`, summary variant). Free-text cards link to the full
 * list on Theo câu hỏi.
 */
export function SummaryScreen() {
  const { formId, version, data, error, reload } = useAnalytics();
  const { form } = useFormHeader();

  if (error && !data) {
    return (
      <div className={PAGE}>
        <ResultsError message={analyticsLoadErrorMessage(error)} onRetry={reload} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className={PAGE}>
        <AnalyticsSkeleton layout="summary" label="Đang tải thống kê câu trả lời…" />
      </div>
    );
  }

  if (data.totalResponses === 0) {
    const live = form ? statusViewOf(form) === "RUNNING" : false;
    return (
      <div className={PAGE}>
        <ResultsEmpty title="Chưa có câu trả lời nào" action={live ? <CopySurveyLink formId={formId} /> : undefined}>
          Khi có người hoàn thành khảo sát, câu trả lời và thống kê sẽ hiện ở đây.
        </ResultsEmpty>
      </div>
    );
  }

  const versionQuery = version ? `&v=${version}` : "";
  const responsesBase = `/forms/${encodeURIComponent(formId)}/responses`;
  const questionHref = (questionId: string) =>
    `${responsesBase}/questions?question=${encodeURIComponent(questionId)}${versionQuery}`;

  return (
    <div className={`${PAGE} flex flex-col gap-4 lg:gap-5`}>
      <AnalyticsHeader analytics={data} />
      {data.questions.length ? (
        data.questions.map((question) => (
          <QuestionAnalyticsCard
            key={question.questionId}
            question={question}
            variant="summary"
            seeAllHref={questionHref(question.questionId)}
          />
        ))
      ) : data.form.type === "EXTERNAL" ? (
        <p className="rounded-control bg-surface-subtle px-4 py-3 text-body-sm text-ink-strong">
          {GOOGLE_FORMS_ANSWERS_NOTE}{" "}
          <Link
            href={`${responsesBase}/individual${version ? `?v=${version}` : ""}`}
            className="font-bold text-primary hover:underline"
          >
            Xem mã hoàn thành
          </Link>
        </p>
      ) : (
        <p className="rounded-control bg-surface-subtle px-4 py-3 text-body-sm text-ink-strong">
          Khảo sát này không có câu hỏi nào để thống kê.
        </p>
      )}
    </div>
  );
}
