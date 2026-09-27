"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { TextDivider } from "@/components/ui/TextDivider";
import { getOAuthErrorMessage } from "@/lib/auth/auth-error-messages";
import { readSessionReplacedNotice } from "@/lib/auth/session-notice";
import type { EmailAuthField } from "@/lib/auth/types";
import { sanitizeReturnTo } from "@/lib/onboarding";
import { useEmailAuth, type AuthFocusTarget } from "../hooks/use-email-auth";
import { useRedirectIfSignedIn } from "../hooks/use-redirect-if-signed-in";
import { AuthFooterNote } from "./AuthFooterNote";
import { DemoAccountsHint } from "./DemoAccountsHint";
import { EmailAuthForm } from "./EmailAuthForm";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { SessionReplacedDialog } from "./SessionReplacedDialog";

function hrefWith(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Figma card `62:139` (desktop) / form column of `62:427` (mobile). On mobile
 * the card chrome disappears and the heading is kept for screen readers only.
 * Registration moved to `/register` (`?mode=register` redirects there).
 */
export function LoginPanel() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const oauthErrorCode = searchParams.get("error");
  const sessionNotice = readSessionReplacedNotice(searchParams);

  const auth = useEmailAuth({ mode: "login", returnTo });
  useRedirectIfSignedIn(returnTo);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(sessionNotice !== null);
  // A new object per request, so the same target is refocused on repeat failures.
  const [focusRequest, setFocusRequest] = useState<{ target: AuthFocusTarget } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const registerParams = new URLSearchParams();
  if (returnTo) registerParams.set("returnTo", returnTo);

  function replaceWithout(...keys: string[]) {
    const next = new URLSearchParams(searchParams);
    for (const key of keys) next.delete(key);
    router.replace(hrefWith(pathname, next), { scroll: false });
  }

  function handleFieldChange(field: EmailAuthField, value: string) {
    if (oauthErrorCode) replaceWithout("error");
    auth.setField(field, value);
  }

  // Focus after React commits the new state (inputs re-enabled, alert mounted, dialog closed).
  useEffect(() => {
    if (!focusRequest) return;
    const { target } = focusRequest;
    if (target === "email") emailRef.current?.focus();
    else if (target === "password") passwordRef.current?.focus();
    else alertRef.current?.focus();
  }, [focusRequest]);

  async function handleSubmit() {
    const target = await auth.submit();
    if (target) setFocusRequest({ target });
  }

  /** 15e "Đăng nhập lại": close the notice, drop the signal from the URL, focus the email field. */
  function handleSignInAgain() {
    if (!sessionDialogOpen) return;
    setSessionDialogOpen(false);
    replaceWithout("reason", "at");
    setFocusRequest({ target: "email" });
  }

  const formError = auth.formError ?? (oauthErrorCode ? getOAuthErrorMessage(oauthErrorCode) : null);

  return (
    <div
      className="mx-auto flex w-full max-w-[440px] flex-col gap-4 px-6 pb-8 pt-4 lg:max-w-[522px] lg:gap-5 lg:rounded-card lg:border lg:border-line lg:bg-surface lg:p-10"
    >
      <div className="sr-only lg:not-sr-only">
        <h2 className="text-title font-extrabold text-ink">Chào mừng bạn</h2>
        <p className="mt-1.5 text-body text-ink-muted">Đăng nhập hoặc tạo tài khoản mới.</p>
      </div>

      {formError ? (
        <Alert
          ref={alertRef}
          tone="danger"
          onDismiss={auth.formError ? auth.dismissFormError : () => replaceWithout("error")}
        >
          {formError}
        </Alert>
      ) : null}

      <GoogleSignInButton returnTo={returnTo} disabled={auth.isBusy} />
      <TextDivider>hoặc dùng email</TextDivider>
      <EmailAuthForm
        values={auth.values}
        fieldErrors={auth.fieldErrors}
        status={auth.status}
        emailRef={emailRef}
        passwordRef={passwordRef}
        onFieldChange={handleFieldChange}
        onSubmit={handleSubmit}
      />
      <AuthFooterNote registerHref={hrefWith("/register", registerParams)} />
      <DemoAccountsHint disabled={auth.isBusy} onPick={auth.fill} />

      <SessionReplacedDialog
        open={sessionDialogOpen}
        at={sessionNotice?.at ?? null}
        onSignInAgain={handleSignInAgain}
      />
    </div>
  );
}
