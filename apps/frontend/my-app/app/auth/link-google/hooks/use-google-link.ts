"use client";

import { useEffect, useRef, useState } from "react";
import * as authService from "@/lib/auth/auth-service";
import { getGoogleLinkErrorMessage } from "@/lib/auth/auth-error-messages";
import { clearPendingEmail } from "@/lib/auth/pending-email";
import type { EmailAuthFieldErrors, EmailAuthFormValues } from "@/lib/auth/types";
import { validateCredentials } from "@/lib/auth/validate-credentials";

export type GoogleLinkFocusTarget = "email" | "password" | "form";

/**
 * 15d: signs in with the Rescom password (VERIFIED POST /auth/login), starts the
 * link (VERIFIED POST /auth/google/link/start) and leaves for Google.
 */
export function useGoogleLink() {
  const [fieldErrors, setFieldErrors] = useState<EmailAuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "redirecting">("idle");
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  function clearFieldError(field: keyof EmailAuthFieldErrors) {
    setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  async function submit(values: EmailAuthFormValues): Promise<GoogleLinkFocusTarget | null> {
    if (inFlight.current) return null;

    const validation = validateCredentials(values, "login");
    if (!validation.ok) {
      setFormError(null);
      setFieldErrors(validation.fields);
      return validation.fields.email ? "email" : "password";
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setStatus("submitting");
    setFormError(null);
    setFieldErrors({});
    try {
      const authorizationUrl = await authService.signInAndStartGoogleLink(
        validation.data,
        controller.signal,
      );
      setStatus("redirecting");
      clearPendingEmail("google-link");
      // Google (or the MOCK-ONLY callback URL) — leaves the React tree.
      window.location.assign(authorizationUrl);
      return null;
    } catch (error) {
      inFlight.current = null;
      if (controller.signal.aborted) return null;
      const message = getGoogleLinkErrorMessage(error);
      setFieldErrors(message.fields ?? {});
      setFormError(message.form ?? null);
      setStatus("idle");
      if (message.fields?.email) return "email";
      return message.fields?.password ? "password" : "form";
    }
  }

  return {
    fieldErrors,
    formError,
    status,
    isBusy: status !== "idle",
    clearFieldError,
    submit,
  };
}
