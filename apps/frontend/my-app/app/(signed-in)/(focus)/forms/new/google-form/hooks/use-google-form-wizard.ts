"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { createSurveyErrorMessage, isInsufficientBalanceError } from "@/lib/forms/create-messages";
import { createGoogleFormSurvey, estimateAudience } from "@/lib/forms/create-service";
import {
  browserStorage,
  clearWizardDraft,
  loadWizardDraft,
  saveWizardDraft,
  stashSubmittedSurvey,
} from "@/lib/forms/create-storage";
import {
  WIZARD_STEPS,
  escrowQuote,
  hasErrors,
  parseWizardStep,
  reachableStep,
  rewardOf,
  sampleSizeOf,
  toCreateRequest,
  toTargetingJson,
  validateAudienceStep,
  validateStep,
  type GoogleFormWizardDraft,
  type WizardErrors,
  type WizardStep,
} from "@/lib/forms/create-wizard";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

const WIZARD_PATH = "/forms/new/google-form";
export const CHOOSE_METHOD_HREF = "/forms/new";

export function stepHref(step: WizardStep): string {
  return `${WIZARD_PATH}?step=${step}`;
}

/**
 * State of the Google Forms wizard (Figma 9a–9c'): the draft (kept in
 * localStorage per user), the `?step=` URL state (a step opens only when the
 * earlier ones are valid), per-step validation shown after "Tiếp tục", the
 * live escrow quote against `useSession().balance.available`, and the submit
 * (`POST /forms/external` + autoPublish) that leads to 9d.
 */
export function useGoogleFormWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, balance, refresh } = useSession();
  const userId = user?.id ?? "";

  // SessionGate renders this only in the browser, once signed in.
  const [draft, setDraft] = useState<GoogleFormWizardDraft>(() => loadWizardDraft(browserStorage("local"), userId));
  const [attempted, setAttempted] = useState<ReadonlySet<WizardStep>>(() => new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  /** The server refused for lack of points (409) — shown as 9c' even if the cached balance disagreed. */
  const [serverShortfall, setServerShortfall] = useState(false);

  const requested = parseWizardStep(searchParams.get("step"));
  const step = reachableStep(requested, draft);

  useEffect(() => {
    if (step !== requested) router.replace(stepHref(step));
  }, [step, requested, router]);

  useEffect(() => {
    if (userId) saveWizardDraft(browserStorage("local"), userId, draft);
  }, [draft, userId]);

  const update = useCallback((patch: Partial<GoogleFormWizardDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setServerShortfall(false);
    setSubmitError(null);
  }, []);

  const errors: WizardErrors = attempted.has(step) ? validateStep(step, draft) : {};

  const next = useCallback(() => {
    if (hasErrors(validateStep(step, draft))) {
      setAttempted((current) => new Set(current).add(step));
      return;
    }
    if (step < 3) router.push(stepHref((step + 1) as WizardStep));
  }, [draft, router, step]);

  const back = useCallback(() => {
    router.push(step === 1 ? CHOOSE_METHOD_HREF : stepHref((step - 1) as WizardStep));
  }, [router, step]);

  // Step 3: live cost vs the available balance (Figma 9c "Điểm sẽ khoá vào Ký quỹ").
  const available = balance?.available ?? null;
  const sample = sampleSizeOf(draft);
  const reward = rewardOf(draft);
  const quote = sample !== null && reward !== null && available !== null ? escrowQuote(sample, reward, available) : null;
  const insufficient = serverShortfall || (quote !== null && quote.shortfall > 0);

  const submit = useCallback(async () => {
    const body = toCreateRequest(draft);
    if (!body) {
      const firstInvalid = WIZARD_STEPS.find((candidate) => hasErrors(validateStep(candidate, draft))) ?? 3;
      setAttempted(new Set(WIZARD_STEPS));
      if (firstInvalid !== step) router.push(stepHref(firstInvalid));
      return;
    }
    if (insufficient || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await createGoogleFormSurvey(body);
      stashSubmittedSurvey(browserStorage("session"), {
        formId: created.id,
        userId,
        title: created.title,
        completionCode: created.plaintextCompletionCode,
        externalUrl: created.externalUrl,
        escrowPoints: escrowQuote(body.expectedCompletions, body.rewardPerResponse, 0).cost,
      });
      clearWizardDraft(browserStorage("local"), userId);
      refresh();
      router.replace(`/forms/${created.id}/submitted`);
    } catch (error) {
      if (isInsufficientBalanceError(error)) {
        setServerShortfall(true);
        refresh();
      } else {
        setSubmitError(error);
      }
      setSubmitting(false);
    }
  }, [draft, insufficient, refresh, router, step, submitting, userId]);

  const sessionLost = useSessionLossRedirect(submitError);

  // Step 2: audience estimate (ASSUMED endpoint), debounced while criteria change.
  const targeting = useMemo(() => toTargetingJson(draft), [draft]);
  const targetingKey = JSON.stringify(targeting);
  const debouncedKey = useDebouncedValue(targetingKey, 400);
  const audienceValid = !hasErrors(validateAudienceStep(draft));
  const estimate = useApiQuery(
    step === 2 && audienceValid ? `audience:${debouncedKey}` : null,
    (signal) => estimateAudience(JSON.parse(debouncedKey), signal),
  );

  return {
    step,
    draft,
    update,
    errors,
    next,
    back,
    submit,
    submitting: submitting || sessionLost,
    submitErrorMessage: submitError && !sessionLost ? createSurveyErrorMessage(submitError) : null,
    available,
    quote,
    insufficient,
    estimate: audienceValid ? estimate : null,
  };
}

export type GoogleFormWizardState = ReturnType<typeof useGoogleFormWizard>;
