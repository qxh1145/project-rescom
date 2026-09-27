"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PasswordField } from "@/components/ui/PasswordField";
import { TextField } from "@/components/ui/TextField";
import { clearPendingEmail, readPendingEmail, subscribePendingEmail } from "@/lib/auth/pending-email";
import { AuthCard } from "../../../login/components/AuthCard";
import { AuthFormAlert } from "../../../login/components/AuthFormAlert";
import { useGoogleLink, type GoogleLinkFocusTarget } from "../hooks/use-google-link";

const readEmail = () => readPendingEmail("google-link");
const noEmailOnServer = () => null;

const TEXT_LINK = "self-center text-label font-bold text-primary hover:underline";

/**
 * 15d "Liên kết tài khoản" — Figma `63:2192` (mobile; desktop card ASSUMED).
 *
 * Reached when Google sign-in stops with AUTH_GOOGLE_LINK_REQUIRED
 * (`/auth/error?error=…` or the mock callback). The real backend does not send
 * the email back, so it is only known in mock mode; otherwise the visitor types
 * it (ASSUMED variant of the frame).
 */
export function LinkGooglePanel() {
  const knownEmail = useSyncExternalStore(subscribePendingEmail, readEmail, noEmailOnServer);
  const link = useGoogleLink();
  const [emailInput, setEmailInput] = useState("");
  const [password, setPassword] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ target: GoogleLinkFocusTarget } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const busy = link.isBusy;

  useEffect(() => {
    if (!focusRequest) return;
    const refs = { email: emailRef, password: passwordRef, form: alertRef };
    refs[focusRequest.target].current?.focus();
  }, [focusRequest]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = await link.submit({ email: knownEmail ?? emailInput, password });
    if (!target) return;
    // A remembered email has no field to focus: its error shows in the alert.
    setFocusRequest({ target: target === "email" && knownEmail ? "form" : target });
  }

  const formError = link.formError ?? (knownEmail ? link.fieldErrors.email : null) ?? null;

  return (
    <AuthCard spacing="lg">
      <div className="flex items-start gap-3">
        <span className="flex h-12 shrink-0 items-center rounded-control bg-tone-blue-bg px-[8.5px] text-tone-blue-fg">
          <Icon name="key" size={24} />
        </span>
        <h2 className="text-[20px] font-extrabold leading-[26px] text-ink">
          Email này đã có tài khoản Rescom
        </h2>
      </div>
      <p className="text-body-relaxed text-ink-strong">
        {knownEmail ? (
          <>
            <strong className="font-bold">{knownEmail}</strong> đã đăng ký bằng mật khẩu.
          </>
        ) : (
          "Email Google của bạn đã được đăng ký bằng mật khẩu."
        )}{" "}
        Nhập mật khẩu để liên kết Google với tài khoản này. Sau đó bạn đăng nhập được bằng cả hai
        cách, và không bị tạo tài khoản trùng.
      </p>

      {formError ? <AuthFormAlert ref={alertRef}>{formError}</AuthFormAlert> : null}

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        {knownEmail ? null : (
          <TextField
            ref={emailRef}
            id="link-google-email"
            name="email"
            type="email"
            label="Email"
            placeholder="ban@fpt.edu.vn"
            autoComplete="email"
            inputMode="email"
            required
            disabled={busy}
            value={emailInput}
            error={link.fieldErrors.email}
            onChange={(event) => {
              setEmailInput(event.target.value);
              link.clearFieldError("email");
            }}
          />
        )}
        <PasswordField
          ref={passwordRef}
          id="link-google-password"
          name="password"
          label="Mật khẩu Rescom"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          disabled={busy}
          value={password}
          error={link.fieldErrors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            link.clearFieldError("password");
          }}
        />
        <Button
          type="submit"
          size="2xl"
          radius="field"
          fullWidth
          loading={busy}
          loadingLabel={link.status === "redirecting" ? "Đang chuyển sang Google…" : "Đang liên kết…"}
        >
          Xác nhận và liên kết Google
        </Button>
      </form>

      <Link
        href="/login"
        onClick={() => clearPendingEmail("google-link")}
        className={buttonClassName({ variant: "secondary", size: "base", radius: "field", fullWidth: true })}
      >
        Huỷ, không liên kết
      </Link>
      <Link href="/forgot-password" className={`mt-3 ${TEXT_LINK}`}>
        Quên mật khẩu?
      </Link>
    </AuthCard>
  );
}
