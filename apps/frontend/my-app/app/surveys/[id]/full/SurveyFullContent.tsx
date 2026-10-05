"use client";

import { SurveyFullScreen } from "@/components/feedback/SurveyFullScreen";
import { Spinner } from "@/components/ui/Spinner";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getSurveySummary } from "@/lib/participation/survey-form-service";

/**
 * Loads the survey (public `GET /surveys/:id`); without it — a closed survey
 * is a 404 — the screen drops the survey card.
 */
export function SurveyFullContent({ surveyId }: { surveyId: string }) {
  const summary = useApiQuery(`survey-summary:${surveyId}`, (signal) => getSurveySummary(surveyId, signal));

  if (summary.loading && !summary.data) {
    return (
      <div role="status" aria-label="Đang tải khảo sát" className="flex min-h-dvh items-center justify-center bg-surface-muted text-primary">
        <Spinner className="size-6" />
      </div>
    );
  }

  return (
    <SurveyFullScreen
      survey={
        summary.data
          ? {
              title: summary.data.title,
              responseCount: summary.data.completedCompletions,
              responseQuota: summary.data.expectedCompletions,
            }
          : undefined
      }
    />
  );
}
