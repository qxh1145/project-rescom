"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import {
  FALLBACK_NOTICE_VERSION,
  acceptIntegrityConsent,
  getIntegrityConsent,
  hasAcceptedCurrentNotice,
  isConsentNoticeOutdated,
  isConsentUnreachable,
} from "@/lib/participation/consent-service";
import {
  CONSENT_NOTICE_UPDATED_MESSAGE,
  CONSENT_NOT_RECORDED_MESSAGE,
  CONSENT_STATUS_UNAVAILABLE_MESSAGE,
} from "@/lib/participation/participation-messages";
import { consentPath, startAttemptDecision } from "@/lib/participation/start-flow";
import { getSurveySummary } from "@/lib/participation/survey-form-service";
import { isSessionLost } from "@/lib/session/session-status";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

export interface StartError {
  /** `info`: a final answer, nothing to retry; `danger`: a failure worth retrying. */
  tone: "info" | "danger";
  message: string;
  /** "Báo Admin" hint (completion-code limit). */
  support?: boolean;
}

/**
 * `/surveys/:id/start` (Figma 14): show the integrity notice for in-Rescom
 * surveys, then start (or resume) the attempt and open it.
 * Google Forms surveys and users who already accepted the current notice
 * version start immediately (consent is remembered per notice version).
 * Consent failures without any response are tolerated (the notice shows the
 * fallback version; an unrecorded acceptance does not block the survey);
 * every HTTP error of the consent routes is shown.
 */
export function useStartSurvey(surveyId: string) {
  const router = useRouter();
  const { refresh } = useSession();
  const summary = useApiQuery(`survey-summary:${surveyId}`, (signal) => getSurveySummary(surveyId, signal));
  const consent = useApiQuery("integrity-consent", (signal) => getIntegrityConsent(signal));
  const reloadConsent = consent.reload;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StartError | null>(null);
  const autoStarted = useRef(false);
  // 401 while loading: SessionGate takes over (the notice is not shown to a signed-out visitor).
  const sessionLost = useSessionLossRedirect(summary.error, consent.error);

  const loading = summary.loading || consent.loading || sessionLost;
  const noticeVersion = consent.data?.currentVersion ?? FALLBACK_NOTICE_VERSION;
  // A failed summary (404: no longer published) falls back to the in-Rescom notice.
  const isExternal = summary.data?.type === "EXTERNAL";
  const autoStart = !loading && (isExternal || hasAcceptedCurrentNotice(consent.data));
  // The notice status answered with an error: shown with a retry, never hidden.
  const consentUnavailable =
    !loading && !autoStart && consent.error !== null && !isConsentUnreachable(consent.error);

  const run = useCallback(
    async (recordConsent: boolean) => {
      if (recordConsent) {
        const failure = await acceptIntegrityConsent(noticeVersion).then(
          () => null,
          (cause: unknown) => (isConsentUnreachable(cause) ? null : cause),
        );
        if (failure !== null) {
          setBusy(false);
          if (isSessionLost(failure)) {
            refresh();
          } else if (isConsentNoticeOutdated(failure)) {
            // A newer notice is in force: show it before asking again.
            setError({ tone: "danger", message: CONSENT_NOTICE_UPDATED_MESSAGE });
            reloadConsent();
          } else {
            setError({ tone: "danger", message: CONSENT_NOT_RECORDED_MESSAGE });
          }
          return;
        }
      }
      // Shared with Khám phá (3A): resume, quota full, onboarding, inline messages.
      const decision = await startAttemptDecision(surveyId, { returnTo: consentPath(surveyId) });
      if (decision.kind === "navigate") {
        router.replace(decision.href);
        return;
      }
      setBusy(false);
      if (decision.kind === "session") {
        refresh();
        return;
      }
      setError({ tone: decision.tone, message: decision.message, support: decision.support });
    },
    [noticeVersion, refresh, reloadConsent, router, surveyId],
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
    /** The consent status answered with an error (shown with a retry). */
    consentError: consentUnavailable ? CONSENT_STATUS_UNAVAILABLE_MESSAGE : null,
    busy,
    error,
    accept,
    retry,
  };
}
