"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { TextDivider } from "@/components/ui/TextDivider";
import { TextField } from "@/components/ui/TextField";
import { AUTH_MESSAGES } from "@/lib/auth/auth-error-messages";
import { sanitizeReturnTo } from "@/lib/onboarding";
import { AuthCard } from "../../login/components/AuthCard";
import { AuthFormAlert } from "../../login/components/AuthFormAlert";
import { GoogleSignInButton } from "../../login/components/GoogleSignInButton";
import { useEmailAuth, type AuthFocusTarget } from "../../login/hooks/use-email-auth";
import { PasswordStrengthMeter } from "./PasswordStrengthMeter";
import { StarterPointsNote } from "./StarterPointsNote";

type FocusTarget = AuthFocusTarget | "terms";

const IDS = {
  email: "register-email",
  password: "register-password",
  strength: "register-password-strength",
  terms: "register-terms",
  termsError: "register-terms-error",
} as const;

const INLINE_LINK = "font-bold underline";

/**
 * `/register` — Figma `63:3405` (desktop card) / `63:4184` (mobile), 409 state
 * `63:3990` (top alert + email field error with recovery links).
 */
export function RegisterPanel() {
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get("returnTo"));
  const auth = useEmailAuth({ mode: "register", returnTo });
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);
  // A new object per failed submit, so the same target is refocused on repeat failures.
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  const loginHref = returnTo ? `/login?${new URLSearchParams({ returnTo })}` : "/login";
  const busy = auth.isBusy;

  useEffect(() => {
    if (!focusRequest) return;
    const refs = { email: emailRef, password: passwordRef, terms: termsRef, form: alertRef };
    refs[focusRequest.target].current?.focus();
  }, [focusRequest]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!termsAccepted) {
      setTermsError(AUTH_MESSAGES.termsRequired);
      setFocusRequest({ target: auth.validate() ?? "terms" });
      return;
    }
    const target = await auth.submit();
    if (target) setFocusRequest({ target });
  }

  const emailTaken = auth.fieldErrors.email === AUTH_MESSAGES.emailTaken;
  const emailError = emailTaken ? (
    <span className="flex items-start gap-1.5 font-medium leading-[18.9px]">
      <Icon name="alert-circle" size={15} className="mt-0.5" />
      <span>
        {AUTH_MESSAGES.emailTaken}{" "}
        <Link href={loginHref} className={`${INLINE_LINK} text-danger-strong`}>
          Đăng nhập
        </Link>{" "}
        hoặc{" "}
        <Link href="/forgot-password" className={`${INLINE_LINK} text-danger-strong`}>
          đặt lại mật khẩu
        </Link>
        .
      </span>
    </span>
  ) : (
    auth.fieldErrors.email
  );

  const passwordErrorId = auth.fieldErrors.password ? `${IDS.password}-error` : null;

  return (
    <AuthCard title="Tạo tài khoản" subtitle="Miễn phí, mất khoảng 2 phút.">
      {auth.formError ? <AuthFormAlert ref={alertRef}>{auth.formError}</AuthFormAlert> : null}

      <GoogleSignInButton returnTo={returnTo} disabled={busy} variant="secondary" />
      <TextDivider>hoặc dùng email</TextDivider>

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
        <TextField
          ref={emailRef}
          id={IDS.email}
          name="email"
          type="email"
          label="Email"
          placeholder="ban@fpt.edu.vn"
          autoComplete="email"
          inputMode="email"
          required
          disabled={busy}
          value={auth.values.email}
          error={emailError}
          onChange={(event) => auth.setField("email", event.target.value)}
        />

        <div className="flex flex-col gap-2.5">
          <TextField
            ref={passwordRef}
            id={IDS.password}
            name="password"
            type="password"
            label="Mật khẩu"
            placeholder="Ít nhất 12 ký tự"
            autoComplete="new-password"
            required
            disabled={busy}
            value={auth.values.password}
            error={auth.fieldErrors.password}
            // TextField only links its own error; the strength helper describes the field too.
            aria-describedby={[passwordErrorId, IDS.strength].filter(Boolean).join(" ")}
            onChange={(event) => auth.setField("password", event.target.value)}
          />
          <PasswordStrengthMeter id={IDS.strength} password={auth.values.password} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Checkbox
            ref={termsRef}
            id={IDS.terms}
            name="terms"
            size={20}
            required
            disabled={busy}
            checked={termsAccepted}
            aria-invalid={termsError ? true : undefined}
            aria-describedby={termsError ? IDS.termsError : undefined}
            onChange={(event) => {
              setTermsAccepted(event.target.checked);
              if (event.target.checked) setTermsError(null);
            }}
            label={
              // Terms/privacy pages are not built yet (ASSUMED routes).
              <span className="text-body-sm">
                Tôi đồng ý với{" "}
                <Link href="/terms" target="_blank" className={`${INLINE_LINK} text-primary`}>
                  Điều khoản
                </Link>{" "}
                và{" "}
                <Link href="/privacy" target="_blank" className={`${INLINE_LINK} text-primary`}>
                  Chính sách quyền riêng tư
                </Link>
              </span>
            }
          />
          {termsError ? (
            <p id={IDS.termsError} className="text-caption text-danger">
              {termsError}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          size="2xl"
          radius="field"
          fullWidth
          loading={busy}
          loadingLabel={auth.status === "redirecting" ? "Đang chuyển trang…" : "Đang tạo tài khoản…"}
        >
          Tạo tài khoản
        </Button>
      </form>

      <StarterPointsNote />

      <p className="text-center text-label text-ink-muted">
        Đã có tài khoản?{" "}
        <Link href={loginHref} className="font-bold text-primary hover:underline">
          Đăng nhập
        </Link>
      </p>
    </AuthCard>
  );
}
