"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PasswordField } from "@/components/ui/PasswordField";
import { isApiError } from "@/lib/api/api-error";
import { AUTH_MESSAGES, getGoogleLinkErrorMessage } from "@/lib/auth/auth-error-messages";
import { startGoogleLink } from "@/lib/auth/auth-service";
import { isSessionLost } from "@/lib/session/session-status";
import { useSession } from "@/lib/session/SessionProvider";
import { ACCOUNT_MESSAGES } from "@/lib/profile/account-messages";

const TITLE_ID = "google-link-title";
const PASSWORD_ID = "google-link-password";

interface GoogleLinkDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Google · Liên kết" on the account page (ASSUMED (design), not drawn): confirms the
 * Rescom password, then VERIFIED `POST /auth/google/link/start
 * { currentPassword }` (signed-in session + CSRF, `google-oauth.controller.ts`)
 * answers `{ authorizationUrl }` and the browser leaves for Google, which
 * returns to `/auth/callback`. Unlike 15d (`/auth/link-google`, the
 * login-time AUTH_GOOGLE_LINK_REQUIRED flow) there is no second login.
 */
export function GoogleLinkDialog({ open, onClose }: GoogleLinkDialogProps) {
  const { refresh } = useSession();
  const [password, setPassword] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "redirecting">("idle");
  const inFlight = useRef<AbortController | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const busy = status !== "idle";

  useEffect(() => () => inFlight.current?.abort(), []);

  const close = () => {
    if (busy) return;
    setPassword("");
    setFieldError(null);
    setFormError(null);
    onClose();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      setFieldError(AUTH_MESSAGES.passwordRequired);
      passwordRef.current?.focus();
      return;
    }
    const controller = new AbortController();
    inFlight.current = controller;
    setStatus("submitting");
    setFieldError(null);
    setFormError(null);
    try {
      const authorizationUrl = await startGoogleLink(password, controller.signal);
      setStatus("redirecting");
      // Google (or the MOCK-ONLY callback URL) — leaves the React tree.
      window.location.assign(authorizationUrl);
    } catch (error) {
      inFlight.current = null;
      if (controller.signal.aborted) return;
      setStatus("idle");
      // A wrong password is also a 401: only other 401s / a locked account end the session.
      if (isSessionLost(error) && !(isApiError(error) && error.code === "AUTH_INVALID_CREDENTIALS")) {
        refresh();
        return;
      }
      const message = getGoogleLinkErrorMessage(error);
      if (message.fields?.password) {
        setFieldError(message.fields.password);
        passwordRef.current?.focus();
      } else {
        // No email field here: an input error can only be the password.
        setFormError(message.form ?? (message.fields?.email ? AUTH_MESSAGES.passwordRequired : AUTH_MESSAGES.server));
      }
    }
  }

  return (
    <Dialog open={open} onClose={close} labelledBy={TITLE_ID} width={480} dismissible={!busy}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4 px-6 pt-7 pb-6">
        <div>
          <h2 id={TITLE_ID} className="text-[20px] font-extrabold text-ink">
            Liên kết Google
          </h2>
          <p className="mt-2 text-body-relaxed text-ink-muted">{ACCOUNT_MESSAGES.googleLinkNote}</p>
        </div>
        <PasswordField
          ref={passwordRef}
          id={PASSWORD_ID}
          label="Mật khẩu Rescom"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            if (fieldError) setFieldError(null);
          }}
          error={fieldError ?? undefined}
          disabled={busy}
        />
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" size="base" radius="field" onClick={close} disabled={busy}>
            Để sau
          </Button>
          <Button
            type="submit"
            size="base"
            radius="field"
            loading={busy}
            loadingLabel={status === "redirecting" ? "Đang mở Google…" : "Đang kiểm tra…"}
          >
            Tiếp tục với Google
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
