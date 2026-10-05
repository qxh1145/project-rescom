"use client";

import { useEffect, useRef, useState } from "react";
import * as authService from "@/lib/auth/auth-service";
import {
  getResetPasswordErrorMessage,
  type ResetPasswordErrorMessage,
} from "@/lib/auth/auth-error-messages";
import { validateNewPassword } from "@/lib/auth/validate-credentials";

export type ResetPasswordResult =
  | { ok: true }
  | { ok: false; error: ResetPasswordErrorMessage & { confirm?: string } };

/**
 * VERIFIED `POST /auth/password/reset` (plan 5.4). Validates with the shared
 * registration policy first, so only a dead link, the rate limit or a
 * transport failure normally comes back from the server.
 */
export function useResetPassword(token: string) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  async function submit(password: string, confirm: string): Promise<ResetPasswordResult | null> {
    if (inFlight.current) return null;

    const validation = validateNewPassword(password, confirm);
    if (!validation.ok) {
      return { ok: false, error: { password: validation.password, confirm: validation.confirm } };
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    try {
      await authService.resetPassword({ token, newPassword: validation.password }, controller.signal);
      return { ok: true };
    } catch (error) {
      if (controller.signal.aborted) return null;
      return { ok: false, error: getResetPasswordErrorMessage(error) };
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return { busy, submit };
}
