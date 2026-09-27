"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as authService from "@/lib/auth/auth-service";
import { getAuthErrorMessage } from "@/lib/auth/auth-error-messages";
import type {
  AuthMode,
  AuthSubmitStatus,
  EmailAuthField,
  EmailAuthFieldErrors,
  EmailAuthFormValues,
} from "@/lib/auth/types";
import { validateCredentials } from "@/lib/auth/validate-credentials";

/** What the caller should focus after a failed submit. */
export type AuthFocusTarget = EmailAuthField | "form";

const FIELD_ORDER: readonly EmailAuthField[] = ["email", "password"];

function firstInvalidField(fields: EmailAuthFieldErrors): EmailAuthField | null {
  return FIELD_ORDER.find((field) => fields[field]) ?? null;
}

interface UseEmailAuthOptions {
  mode: AuthMode;
  returnTo: string | null;
}

/**
 * Email login/register state machine: idle → submitting → redirecting.
 * Talks only to `lib/auth/auth-service` (never to MSW or mock data).
 */
export function useEmailAuth({ mode, returnTo }: UseEmailAuthOptions) {
  const router = useRouter();
  const [values, setValues] = useState<EmailAuthFormValues>({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<EmailAuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthSubmitStatus>("idle");
  const inFlight = useRef<AbortController | null>(null);

  // Leaving the page (unmount, or Next keeping it hidden for back/forward) aborts a
  // pending request and releases the form: if the redirect never completes, the
  // user comes back to a usable form instead of one stuck on "redirecting".
  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
      setStatus("idle");
    },
    [],
  );

  const setField = useCallback((field: EmailAuthField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }, []);

  const fill = useCallback((next: EmailAuthFormValues) => {
    setValues(next);
    setFieldErrors({});
    setFormError(null);
  }, []);

  const resetErrors = useCallback(() => {
    setFieldErrors({});
    setFormError(null);
  }, []);

  /** Client-side check only (shows field errors). Returns the field to focus, or null if valid. */
  function validate(): EmailAuthField | null {
    const validation = validateCredentials(values, mode);
    if (validation.ok) return null;
    setFormError(null);
    setFieldErrors(validation.fields);
    return firstInvalidField(validation.fields);
  }

  async function submit(): Promise<AuthFocusTarget | null> {
    if (inFlight.current) return null;

    const validation = validateCredentials(values, mode);
    if (!validation.ok) {
      setFormError(null);
      setFieldErrors(validation.fields);
      return firstInvalidField(validation.fields);
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setStatus("submitting");
    setFormError(null);
    setFieldErrors({});

    try {
      if (mode === "register") {
        await authService.register(validation.data, controller.signal);
      } else {
        await authService.login(validation.data, controller.signal);
      }
      setStatus("redirecting");
      const destination = await authService.resolvePostLoginDestination(returnTo, controller.signal);
      if (!controller.signal.aborted) router.replace(destination);
      return null;
    } catch (error) {
      inFlight.current = null;
      if (controller.signal.aborted) return null;
      const message = getAuthErrorMessage(error, mode);
      setFieldErrors(message.fields ?? {});
      setFormError(message.form ?? null);
      setStatus("idle");
      return message.fields ? firstInvalidField(message.fields) : "form";
    }
  }

  return {
    values,
    fieldErrors,
    formError,
    status,
    isBusy: status !== "idle",
    setField,
    fill,
    resetErrors,
    dismissFormError: () => setFormError(null),
    validate,
    submit,
  };
}
