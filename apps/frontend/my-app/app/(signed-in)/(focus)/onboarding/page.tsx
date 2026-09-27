import { Suspense } from "react";
import type { Metadata } from "next";
import { OnboardingFlow } from "./components/OnboardingFlow";

export const metadata: Metadata = {
  title: "Hoàn tất hồ sơ — Rescom",
};

/**
 * Figma page 12 (55:14) "Onboarding mới – mỗi màn 1 câu, 4 phần". The step is
 * URL state (`?step=birth-year`); `required=1` and `returnTo` come from
 * `buildOnboardingRedirect` (`lib/onboarding.ts`) and are kept on every step.
 */
export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingFlow />
    </Suspense>
  );
}
