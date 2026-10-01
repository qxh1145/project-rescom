"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsSkeleton";
import { QuestionAnalyticsCard } from "@/components/analytics/QuestionAnalyticsCard";
import { TextAnswerList, type TextAnswer } from "@/components/analytics/TextAnswerList";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import type { QuestionAnalytics } from "@/lib/forms/results-analytics-service";
import { formatCount, resolveQuestionIndex, visualOf } from "@/lib/forms/results-analytics";
import {
  analyticsLoadErrorMessage,
  GOOGLE_FORMS_ANSWERS_NOTE,
  RESPONSES_TRUNCATED_NOTE,
  responsesLoadErrorMessage,
} from "@/lib/forms/results-messages";
import { answerText, normalizeSearchText } from "@/lib/forms/results-view";
import { useAnalytics } from "../hooks/analytics-context";
import { useResponses } from "../hooks/responses-context";
import { SearchBox } from "./ResponsesToolbar";
import { ResultsEmpty, ResultsError } from "./ResultsStatus";

const PAGE = "mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12";
const ANSWERS_STEP = 20;
const NAV_BUTTON = "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-surface-subtle";

/** Every answer of a free-text question from `GET /forms/:id/responses` (already newest first), searchable. */
function AllTextAnswers({ question }: { question: QuestionAnalytics }) {
  const { data, error, loading, reload } = useResponses();
  const [query, setQuery] = useState("");
  const rows = data?.availability === "AVAILABLE" ? data : null;
  const answers = useMemo<TextAnswer[] | null>(() => {
    const source = rows?.questions.find((item) => item.id === question.questionId);
    if (!rows || !source) return null;
    return rows.responses
      .map((response) => ({
        key: response.id,
        value: answerText(source, response.answers[source.id]),
        submittedAt: response.submittedAt,
      }))
      .filter((answer) => answer.value !== "");
  }, [rows, question.questionId]);
  const needle = normalizeSearchText(query);
  const matches = useMemo(
    () => (answers && needle ? answers.filter((answer) => normalizeSearchText(answer.value).includes(needle)) : answers),
    [answers, needle],
  );

  if (error && !data) return <ResultsError message={responsesLoadErrorMessage(error)} onRetry={reload} />;
  if (!data) {
    return (
      <p className="flex items-center gap-3 py-4 text-body-sm text-ink-muted" role="status" aria-busy={loading}>
        <Spinner className="size-4 text-primary" />
        Đang tải tất cả câu trả lời…
      </p>
    );
  }
  if (!answers || !matches) return <p className="text-body-sm text-ink-muted">Câu hỏi này không có trong phiên bản đang xem.</p>;
  return (
    <div className="flex flex-col gap-3">
      {answers.length ? <SearchBox value={query} onChange={setQuery} size="desktop" label="Tìm trong câu trả lời" /> : null}
      {rows?.truncated ? <p className="text-caption text-tone-amber-fg">{RESPONSES_TRUNCATED_NOTE}</p> : null}
      <p className="text-caption text-ink-muted" aria-live="polite">
        Mới nhất trước ·{" "}
        {needle
          ? `${formatCount(matches.length)} / ${formatCount(answers.length)} câu trả lời`
          : `${formatCount(answers.length)} câu trả lời`}
      </p>
      {/* Remounting on a new query resets "Xem thêm" paging. */}
      <TextAnswerList
        key={`${question.questionId}:${needle}`}
        answers={matches}
        pageSize={ANSWERS_STEP}
        emptyLabel={needle ? "Không có câu trả lời phù hợp." : undefined}
      />
    </div>
  );
}

/**
 * Câu trả lời → Theo câu hỏi: one question at a time (`?question=<id>`,
 * default the first) with prev/next, a question picker and the full table.
 * Free-text questions list every answer from the responses data.
 */
export function QuestionScreen() {
  const { data, error, reload } = useAnalytics();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

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
        <AnalyticsSkeleton layout="question" label="Đang tải thống kê câu hỏi…" />
      </div>
    );
  }
  if (data.availability === "NOT_APPLICABLE") {
    return (
      <div className={PAGE}>
        <p className="rounded-control bg-surface-subtle px-4 py-3 text-body-sm text-ink-strong">{GOOGLE_FORMS_ANSWERS_NOTE}</p>
      </div>
    );
  }
  if (data.totalResponses === 0) {
    return (
      <div className={PAGE}>
        <ResultsEmpty title="Chưa có câu trả lời nào">
          Khi có người hoàn thành khảo sát, câu trả lời và thống kê sẽ hiện ở đây.
        </ResultsEmpty>
      </div>
    );
  }

  const { questions } = data;
  const index = resolveQuestionIndex(questions, search.get("question"));
  const question = questions[index];
  if (!question) {
    return (
      <div className={PAGE}>
        <p className="rounded-control bg-surface-subtle px-4 py-3 text-body-sm text-ink-strong">
          Khảo sát này không có câu hỏi nào để thống kê.
        </p>
      </div>
    );
  }

  const goTo = (questionId: string) => {
    const next = new URLSearchParams(search.toString());
    next.set("question", questionId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const previous = questions[index - 1];
  const following = questions[index + 1];

  return (
    <div className={`${PAGE} flex flex-col gap-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <IconButton
            icon="chevron-left"
            label="Câu hỏi trước"
            className={NAV_BUTTON}
            disabled={!previous}
            onClick={() => previous && goTo(previous.questionId)}
          />
          <IconButton
            icon="chevron-right"
            label="Câu hỏi sau"
            className={NAV_BUTTON}
            disabled={!following}
            onClick={() => following && goTo(following.questionId)}
          />
        </div>
        <p className="text-body-sm font-bold whitespace-nowrap text-ink" aria-live="polite">
          Câu {index + 1} / {questions.length}
        </p>
        <Select
          id="analytics-question"
          aria-label="Chọn câu hỏi"
          height={44}
          className="w-full sm:w-auto sm:max-w-[520px] sm:flex-1"
          options={questions.map((item) => ({ value: item.questionId, label: `Câu ${item.number} · ${item.title}` }))}
          value={question.questionId}
          onChange={(event) => goTo(event.target.value)}
        />
      </div>
      <QuestionAnalyticsCard
        key={question.questionId}
        question={question}
        variant="detail"
        textAnswers={visualOf(question) === "text-list" ? <AllTextAnswers question={question} /> : undefined}
      />
    </div>
  );
}
