"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import {
  FALLBACK_NOTICE_VERSION,
  acceptIntegrityConsent,
  getIntegrityConsent,
  hasAcceptedCurrentNotice,
  isConsentRouteMissing,
} from "@/lib/participation/consent-service";
import { CONSENT_NOT_RECORDED_MESSAGE } from "@/lib/participation/participation-messages";
import { consentPath, startAttemptDecision } from "@/lib/participation/start-flow";
import { getSurveySummary } from "@/lib/participation/survey-form-service";

/**
 * `/surveys/:id/start` (Figma 14): show the integrity notice for in-Rescom
 * surveys, then start (or resume) the attempt and open it.
 * Google Forms surveys and users who already accepted the current notice
 * version start immediately (ASSUMED: consent remembered per version).
 */
export function useStartSurvey(surveyId: string) {
  const router = useRouter();
  const summary = useApiQuery(`survey-summary:${surveyId}`, (signal) => getSurveySummary(surveyId, signal));
  const consent = useApiQuery("integrity-consent", (signal) => getIntegrityConsent(signal));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const loading = summary.loading || consent.loading;
  const noticeVersion = consent.data?.currentVersion ?? FALLBACK_NOTICE_VERSION;
  // A failed summary (route missing) falls back to the in-Rescom notice.
  const isExternal = summary.data?.type === "EXTERNAL";
  const autoStart = !loading && (isExternal || hasAcceptedCurrentNotice(consent.data));

  const run = useCallback(
    async (recordConsent: boolean) => {
      if (recordConsent) {
        const recorded = await acceptIntegrityConsent(noticeVersion).then(
          () => true,
          (cause: unknown) => isConsentRouteMissing(cause),
        );
        if (!recorded) {
          setError(CONSENT_NOT_RECORDED_MESSAGE);
          setBusy(false);
          return;
        }
      }
      // Shared with Khám phá (3A): resume, quota full, onboarding, inline messages.
      const decision = await startAttemptDecision(surveyId, { returnTo: consentPath(surveyId) });
      if (decision.kind === "navigate") {
        router.replace(decision.href);
        return;
      }
      setError(decision.message);
      setBusy(false);
    },
    [noticeVersion, router, surveyId],
  );

  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    void run(false);
  }, [autoStart, run]);

  const accept = useCallback(() => {
    setError(null);
    setBusy(true);
    void run(true);
  }, [run]);

  const retry = useCallback(() => {
    setError(null);
    autoStarted.current = false;
    summary.reload();
    consent.reload();
  }, [consent, summary]);

  return {
    summary: summary.data ?? null,
    noticeVersion,
    loading,
    /** Starting without the notice (Google Forms / already accepted). */
    autoStart,
    busy,
    error,
    accept,
    retry,
  };
}
