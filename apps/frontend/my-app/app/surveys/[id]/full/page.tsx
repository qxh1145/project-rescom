import type { Metadata } from "next";
import { SurveyFullContent } from "./SurveyFullContent";

export const metadata: Metadata = {
  title: "Khảo sát đã đủ người — Rescom",
};

interface SurveyFullPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Figma 18.7 — reached when starting a survey fails with 409
 * `SURVEY_QUOTA_FULL` (`lib/participation/start-flow.ts`).
 */
export default async function SurveyFullPage({ params }: SurveyFullPageProps) {
  const { id } = await params;
  return <SurveyFullContent surveyId={id} />;
}
