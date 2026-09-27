import { Suspense } from "react";
import type { Metadata } from "next";
import { SurveyTakingScreen } from "./components/SurveyTakingScreen";

export const metadata: Metadata = {
  title: "Làm khảo sát — Rescom",
};

/**
 * Figma page 4 "Làm khảo sát trong RESCOM" (62:158 / 62:732 / 62:1019).
 * Google Forms attempts continue at `/attempts/:id/google-form`; finished
 * attempts at `/attempts/:id/complete`.
 */
export default function AttemptPage() {
  return (
    <Suspense>
      <SurveyTakingScreen />
    </Suspense>
  );
}
