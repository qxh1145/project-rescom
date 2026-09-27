"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isApiError } from "@/lib/api/api-error";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getDemographics, submitDemographicSurvey } from "@/lib/demographics/demographics-service";
import { resolvePostOnboardingPath } from "@/lib/onboarding";
import {
  answersFromServer,
  EMPTY_ANSWERS,
  firstInvalidStep,
  resolveStep,
  stepFromValidationDetails,
  validateStep,
  type OnboardingAnswers,
} from "@/lib/onboarding/onboarding-answers";
import {
  browserSessionStorage,
  chooseAnswers,
  doneOnlyDraft,
  readDraft,
  writeDraft,
  type OnboardingDraft,
} from "@/lib/onboarding/onboarding-draft";
import { ONBOARDING_MESSAGES, onboardingSubmitErrorMessage } from "@/lib/onboarding/onboarding-messages";
import { submitOnboarding } from "@/lib/onboarding/onboarding-submit";
import {
  buildStepHref,
  nextStepOf,
  parseStep,
  previousStepOf,
  type OnboardingStep,
  type QuestionStep,
} from "@/lib/onboarding/onboarding-steps";
import { getUserProfile, updateUserProfile } from "@/lib/profile/profile-service";
import { onboardingEntryRedirect, onboardingStatusOf } from "@/lib/session/onboarding-gate";
import { useSession } from "@/lib/session/SessionProvider";
import { sessionStatusFromError } from "@/lib/session/session-status";

interface StepError {
  step: QuestionStep;
  message: string;
}

/** 401 or a locked account: the session is over and `SessionGate` must take over. */
function endsSession(error: unknown): boolean {
  if (!isApiError(error)) return false;
  const status = sessionStatusFromError(error);
  return status === "unauthenticated" || status === "locked";
}

/**
 * State of `/onboarding`: the step lives in the URL (`?step=`, so back and
 * refresh work), answers in a per-user sessionStorage draft layered over the
 * server profile. The last question submits VERIFIED `POST /demographics/survey`
 * first, then the ASSUMED `PATCH /users/me/profile` best-effort, then shows
 * the done screen.
 */
export function useOnboardingFlow() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const { user, onboarding, displayName, refresh, markOnboardingComplete } = useSession();
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  // Reading sessionStorage in a useState initializer is safe only because this
  // hook never renders on the server: `SessionGate` (FocusShell) shows a spinner
  // until the session is authenticated on the client, so this runs client-side
  // once, with the signed-in user's id. The draft stays bound to that user.
  const [ownerId] = useState(() => user?.id ?? "anonymous");
  const [draft, setDraftState] = useState<OnboardingDraft>(() => readDraft(browserSessionStorage(), ownerId));
  // What the visitor asked for when the page opened (see `onboardingEntryRedirect`).
  const [entry] = useState(() => ({
    requestedStep: parseStep(searchParams.get("step")),
    submittedInThisTab: draft.submitted !== null,
    editing: searchParams.get("edit") === "1",
  }));
  /** `undefined` until decided; then fixed for this visit (`null` = stay). */
  const [entryRedirect, setEntryRedirect] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<StepError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Always read the server copy: it prefills a first visit and wins over an older draft.
  // Only `/demographics` may block loading; the ASSUMED profile route is optional.
  const prefill = useApiQuery(`onboarding-prefill:${ownerId}`, async (signal) => {
    const [demographics, profile] = await Promise.all([
      getDemographics(signal),
      getUserProfile(signal).catch(() => null),
    ]);
    return {
      answers: answersFromServer(demographics.profile, profile, currentYear),
      updatedAt: demographics.profile.updatedAt ?? null,
      isComplete: demographics.isComplete,
    };
  });

  // Decide entry from this fresh `GET /demographics`, not the session snapshot: after an account
  // switch in another tab the snapshot is stale and would bounce `/onboarding` ↔ `/marketplace`.
  // If the read fails, the session value stands in. Set during render (derived state), once.
  const entryStatus =
    user?.role === "ADMIN"
      ? "unknown"
      : prefill.data
        ? onboardingStatusOf(user?.role, prefill.data)
        : prefill.error
          ? onboarding
          : undefined;
  if (entryRedirect === undefined && entryStatus !== undefined) {
    setEntryRedirect(onboardingEntryRedirect({ role: user?.role, onboarding: entryStatus, ...entry }));
  }

  const answers = chooseAnswers(draft, prefill.data) ?? EMPTY_ANSWERS;
  const ready = draft.answers !== null || prefill.data !== undefined;
  const requested = parseStep(searchParams.get("step"));
  const step = ready ? resolveStep(requested, answers, draft.submitted !== null, currentYear) : requested;

  useEffect(() => {
    if (entryRedirect) router.replace(entryRedirect);
    else if (entryRedirect === null && ready && step !== requested) router.replace(buildStepHref(step, query));
  }, [entryRedirect, ready, step, requested, router, query]);

  // A prefill 401/locked: let SessionProvider re-check so SessionGate redirects (the draft survives).
  useEffect(() => {
    if (prefill.error && endsSession(prefill.error)) refresh();
  }, [prefill.error, refresh]);

  const saveDraft = useCallback(
    (next: OnboardingDraft) => {
      setDraftState(next);
      writeDraft(browserSessionStorage(), ownerId, next);
    },
    [ownerId],
  );

  const setAnswers = useCallback(
    (patch: Partial<OnboardingAnswers>) => {
      // Any edit invalidates an earlier submit until "Hoàn tất" is pressed again.
      saveDraft({ answers: { ...answers, ...patch }, submitted: null, updatedAt: new Date().toISOString() });
      setError(null);
    },
    [answers, saveDraft],
  );

  const goTo = useCallback(
    (target: OnboardingStep) => {
      setError(null);
      router.push(buildStepHref(target, query));
    },
    [router, query],
  );

  const submit = useCallback(async () => {
    // Another account signed in on this tab since the flow opened: start over for that user.
    if (user?.id !== ownerId) {
      window.location.reload();
      return;
    }
    const invalid = firstInvalidStep(answers, currentYear);
    if (invalid) {
      setError({ step: invalid, message: validateStep(invalid, answers, currentYear) ?? ONBOARDING_MESSAGES.submitInvalid });
      router.push(buildStepHref(invalid, query));
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitOnboarding(answers, currentYear, {
        submitSurvey: submitDemographicSurvey,
        updateProfile: updateUserProfile,
      });
      if (result.profileError && !(isApiError(result.profileError) && result.profileError.status === 404)) {
        // Best-effort by design: the survey is saved; name/school/goal can be edited later.
        console.warn("Onboarding: PATCH /users/me/profile failed", result.profileError);
      }
      saveDraft({ answers, submitted: { nextStep: result.nextStep }, updatedAt: new Date().toISOString() });
      // `SessionGate` must not send "Tiếp tục" back here before `refresh()` returns.
      markOnboardingComplete();
      // Header name, points and badge pick up the new profile.
      refresh();
      // push (not replace): Back from the done screen returns to the last question.
      router.push(buildStepHref("done", query));
    } catch (cause) {
      if (endsSession(cause)) {
        refresh();
        return;
      }
      const invalidStep =
        isApiError(cause) && cause.status === 400 ? stepFromValidationDetails(cause.details) : null;
      if (invalidStep) {
        setError({ step: invalidStep, message: ONBOARDING_MESSAGES.submitInvalid });
        router.push(buildStepHref(invalidStep, query));
      } else {
        setError({ step: "goal", message: onboardingSubmitErrorMessage(cause) });
      }
    } finally {
      setSubmitting(false);
    }
  }, [user, ownerId, answers, currentYear, saveDraft, markOnboardingComplete, refresh, router, query]);

  const next = useCallback(() => {
    if (step === "welcome" || step === "done" || submitting) return;
    const message = validateStep(step, answers, currentYear);
    if (message) {
      setError({ step, message });
      return;
    }
    const target = nextStepOf(step, answers);
    if (target === "done") void submit();
    else goTo(target);
  }, [step, answers, currentYear, submitting, submit, goTo]);

  const back = useCallback(() => {
    if (step === "welcome" || step === "done") return;
    goTo(previousStepOf(step, answers));
  }, [step, answers, goTo]);

  /**
   * The done screen unmounted: the stored draft keeps only `nextStep` (a
   * refresh of the done screen reads the answers from the server). The
   * in-memory answers stay, so "Sửa" still opens with them.
   */
  const finish = useCallback(() => {
    const storage = browserSessionStorage();
    writeDraft(storage, ownerId, doneOnlyDraft(readDraft(storage, ownerId), new Date().toISOString()));
  }, [ownerId]);

  const nextStep = draft.submitted?.nextStep ?? "MARKETPLACE_ACTIVATION";
  const returnTo = searchParams.get("returnTo");

  return {
    step,
    /** Entry not decided yet, or leaving (finished respondent, admin): render only a spinner. */
    redirecting: entryRedirect !== null,
    ready,
    loadError: draft.answers === null ? prefill.error : null,
    reload: prefill.reload,
    answers,
    setAnswers,
    error: error && error.step === step ? error.message : null,
    submitting,
    next,
    back,
    goTo,
    finish,
    currentYear,
    /** Welcome/done greeting: the answered name, else the session name. */
    greetingName: answers.displayName.trim() || displayName,
    required: searchParams.get("required") === "1",
    nextStep,
    /** Activation (`/marketplace?activation=1`) until done, then `returnTo` or the Marketplace. */
    continueHref: resolvePostOnboardingPath({ nextStep }, returnTo),
    stepHref: (target: OnboardingStep) => buildStepHref(target, query),
  };
}

export type OnboardingFlow = ReturnType<typeof useOnboardingFlow>;
