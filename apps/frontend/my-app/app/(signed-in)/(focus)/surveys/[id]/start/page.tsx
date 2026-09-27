import { Suspense } from "react";
import type { Metadata } from "next";
import { StartSurveyScreen } from "./components/StartSurveyScreen";

export const metadata: Metadata = {
  title: "Trước khi bắt đầu — Rescom",
};

/**
 * Figma page 14 "Thông báo dữ liệu chất lượng" (62:954 / 62:1163): the
 * integrity notice before an in-Rescom survey, then start or resume the attempt.
 */
export default function StartSurveyPage() {
  return (
    <Suspense>
      <StartSurveyScreen />
    </Suspense>
  );
}
