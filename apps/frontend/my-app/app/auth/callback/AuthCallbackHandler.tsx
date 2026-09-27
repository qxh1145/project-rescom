"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { MOCK_GOOGLE_PROVIDER, isApiMockingEnabled } from "@/lib/api/config";
import { isApiError } from "@/lib/api/api-error";
import * as authService from "@/lib/auth/auth-service";
import { savePendingEmail } from "@/lib/auth/pending-email";
import { sanitizeReturnTo } from "@/lib/onboarding";

/**
 * Landing page of the Google flow (backend `AUTH_FRONTEND_SUCCESS_URL`).
 * Confirms the session cookie with `GET /auth/me`, then routes like email login.
 */
export function AuthCallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const provider = searchParams.get("provider");
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));

  // Runs the sign-in handshake once on arrival — an external-system sync, not derived state.
  useEffect(() => {
    const controller = new AbortController();

    async function complete() {
      try {
        if (isApiMockingEnabled && provider === MOCK_GOOGLE_PROVIDER) {
          await authService.completeMockGoogleSignIn(controller.signal);
        }
        await authService.getCurrentUser(controller.signal);
        const destination = await authService.resolvePostLoginDestination(
          returnTo,
          controller.signal,
        );
        if (!controller.signal.aborted) router.replace(destination);
      } catch (error) {
        if (controller.signal.aborted) return;
        // MOCK-ONLY path (scenario `google-link-required`): the real backend reports this
        // through `/auth/error`, without the email.
        if (isApiError(error) && error.code === "AUTH_GOOGLE_LINK_REQUIRED") {
          const email = (error.details as { email?: unknown } | undefined)?.email;
          if (typeof email === "string") savePendingEmail("google-link", email);
          router.replace("/auth/link-google");
          return;
        }
        // Only auth failures mean "session invalid"; network/5xx/malformed get the generic message.
        const code =
          isApiError(error) && error.kind === "http" && (error.status === 401 || error.status === 403)
            ? (error.code ?? "AUTH_UNAUTHORIZED")
            : "AUTH_CALLBACK_FAILED";
        router.replace(`/login?error=${code}`);
      }
    }

    void complete();
    return () => controller.abort();
  }, [provider, returnTo, router]);

  return <AuthCallbackStatus />;
}

export function AuthCallbackStatus() {
  return (
    <div
      role="status"
      className="flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-muted px-6 text-center text-body text-ink-muted"
    >
      <Spinner className="size-6 text-primary" />
      <p>Đang hoàn tất đăng nhập…</p>
    </div>
  );
}
