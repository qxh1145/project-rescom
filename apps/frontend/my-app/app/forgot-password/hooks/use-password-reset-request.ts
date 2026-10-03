"use client";

import { useEffect, useRef, useState } from "react";
import * as authService from "@/lib/auth/auth-service";
import { getPasswordResetErrorMessage } from "@/lib/auth/auth-error-messages";
import type { AuthErrorMessage } from "@/lib/auth/types";
import { validateEmail } from "@/lib/auth/validate-credentials";

export type PasswordResetResult =
  | { ok: true; email: string }
  | { ok: false; error: AuthErrorMessage };

/**
 * Sends `POST /auth/password/forgot` (VERIFIED, `auth.controller.ts`) for 15b (first
 * request) and 15c ("Gửi lại email"). Validation uses the shared email rule.
 */
export function usePasswordResetRequest() {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function send(rawEmail: string): Promise<PasswordResetResult | null> {
    if (inFlight.current) return null;

    const validation = validateEmail(rawEmail);
    if (!validation.ok) return { ok: false, error: { fields: { email: validation.message } } };

    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    try {
      await authService.requestPasswordReset({ email: validation.email }, controller.signal);
      return { ok: true, email: validation.email };
    } catch (error) {
      if (controller.signal.aborted) return null;
      return { ok: false, error: getPasswordResetErrorMessage(error) };
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return { busy, send };
}
