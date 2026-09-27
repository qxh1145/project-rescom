"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getDemographics } from "@/lib/demographics/demographics-service";
import { getEngagementSummary } from "@/lib/engagement/engagement-service";
import { answersFromServer } from "@/lib/onboarding/onboarding-answers";
import { getIntegrityConsent } from "@/lib/participation/consent-service";
import { getReliabilitySummary } from "@/lib/participation/trust-service";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/**
 * Data of `/account` and `/account/profile`:
 * - VERIFIED `GET /demographics` + the session's ASSUMED `GET /users/me/profile` → profile fields;
 * - ASSUMED `GET /engagement/me` → streak, tier, stats, weekly rank;
 * - ASSUMED `GET /integrity/consent` and `GET /integrity/reliability/me` → row values
 *   (best effort: a failure only leaves the row value empty).
 * A 401 / locked account on any of them re-checks the session (SessionGate
 * redirects), and their errors are hidden meanwhile.
 */
export function useAccountData({ withRowDetails = false }: { withRowDetails?: boolean } = {}) {
  const session = useSession();
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const demographics = useApiQuery("account-demographics", (signal) => getDemographics(signal));
  const engagement = useApiQuery("engagement-summary", (signal) => getEngagementSummary(signal));
  const consent = useApiQuery(withRowDetails ? "integrity-consent" : null, (signal) => getIntegrityConsent(signal));
  const reliability = useApiQuery(withRowDetails ? "reliability-summary" : null, (signal) =>
    getReliabilitySummary(signal),
  );

  const sessionLost = useSessionLossRedirect(demographics.error, engagement.error, consent.error, reliability.error);

  const answers = useMemo(
    () =>
      demographics.data ? answersFromServer(demographics.data.profile, session.profile, currentYear) : undefined,
    [demographics.data, session.profile, currentYear],
  );

  if (sessionLost) {
    return {
      session,
      currentYear,
      demographics: { ...demographics, error: null },
      answers,
      engagement: { ...engagement, error: null },
      consent: { ...consent, error: null },
      reliability: { ...reliability, error: null },
    };
  }
  return { session, currentYear, demographics, answers, engagement, consent, reliability };
}

export type AccountData = ReturnType<typeof useAccountData>;
