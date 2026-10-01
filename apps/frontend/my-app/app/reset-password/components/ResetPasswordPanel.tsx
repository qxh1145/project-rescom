"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { PasswordField } from "@/components/ui/PasswordField";
import { AUTH_MESSAGES } from "@/lib/auth/auth-error-messages";
import { PASSWORD_RESET_REASON } from "@/lib/auth/session-notice";
import { AuthCard } from "../../login/components/AuthCard";
import { AuthFormAlert } from "../../login/components/AuthFormAlert";
import { PasswordStrengthMeter } from "../../register/components/PasswordStrengthMeter";
import { useResetPassword } from "../hooks/use-reset-password";

const IDS = {
  password: "reset-password",
  strength: "reset-password-strength",
  confirm: "reset-password-confirm",
} as const;

type FocusTarget = "password" | "confirm" | "form";

/** A link that cannot be used (missing token, or the server said invalid/expired/used). */
function DeadLinkCard({ message }: { message: string }) {
  return (
    <AuthCard className="flex-1 lg:flex-none">
      <div className="flex flex-col items-center px-1 pt-5 text-center lg:pt-0">
        <span className="flex size-18 items-center justify-center rounded-[22px] bg-tone-amber-bg text-tone-amber-fg">
          <Icon name="alert-circle" size={36} />
        </span>
        <h2 className="mt-3.5 text-title-sm font-extrabold text-ink">Link không còn dùng được</h2>
        <p className="mt-3.5 text-body-relaxed text-ink-strong">{message}</p>
      </div>
      <div className="mt-auto flex flex-col gap-2.5 pt-8 lg:mt-2 lg:pt-0">
        <Link href="/forgot-password" className={buttonClassName({ size: "lg", radius: "field", fullWidth: true })}>
          Yêu cầu link mới
        </Link>
        <Link
          href="/login"
          className={buttonClassName({ variant: "secondary", size: "base", radius: "field", fullWidth: true })}
        >
          Về đăng nhập
        </Link>
      </div>
    </AuthCard>
  );
}

/**
 * Plan 5.4 `/reset-password?token=…`: new password + confirmation (same
 * policy and strength meter as registration). Success signs every device out
 * and lands on `/login?reason=password-reset`; a dead link offers a new one.
 */
export function ResetPasswordPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read once, then kept in state only: the URL loses the one-time token right
  // away (history, screenshots, shared links). A reload then needs the email link.
  const [token] = useState(() => searchParams.get("token") ?? "");
  const reset = useResetPassword(token);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [deadLink, setDeadLink] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget } | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const busy = reset.busy || navigating;

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("token")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    const refs = { password: passwordRef, confirm: confirmRef, form: alertRef };
    refs[focusRequest.target].current?.focus();
  }, [focusRequest]);

  if (!token) return <DeadLinkCard message={AUTH_MESSAGES.resetLinkMissing} />;
  if (deadLink) return <DeadLinkCard message={deadLink} />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const result = await reset.submit(password, confirm);
    if (!result) return;
    if (result.ok) {
      setNavigating(true);
      router.replace(`/login?reason=${PASSWORD_RESET_REASON}`);
      return;
    }
    const { error } = result;
    if (error.linkInvalid) {
      setDeadLink(error.form ?? AUTH_MESSAGES.resetLinkInvalid);
      return;
    }
    setPasswordError(error.password);
    setConfirmError(error.confirm);
    setFormError(error.form ?? null);
    setFocusRequest({ target: error.password ? "password" : error.confirm ? "confirm" : "form" });
  }

  const passwordErrorId = passwordError ? `${IDS.password}-error` : null;

  return (
    <AuthCard title="Đặt lại mật khẩu" spacing="lg">
      <p className="text-body-relaxed text-ink-strong">
        Đặt mật khẩu mới cho tài khoản Rescom. Sau khi đổi, mọi thiết bị đang đăng nhập sẽ bị đăng xuất.
      </p>

      {formError ? <AuthFormAlert ref={alertRef}>{formError}</AuthFormAlert> : null}

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        <div className="flex flex-col gap-2.5">
          <PasswordField
            ref={passwordRef}
            id={IDS.password}
            name="newPassword"
            label="Mật khẩu mới"
            placeholder="Ít nhất 12 ký tự"
            autoComplete="new-password"
            required
            disabled={busy}
            value={password}
            error={passwordError}
            aria-describedby={[passwordErrorId, IDS.strength].filter(Boolean).join(" ")}
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(undefined);
            }}
          />
          <PasswordStrengthMeter id={IDS.strength} password={password} />
        </div>
        <PasswordField
          ref={confirmRef}
          id={IDS.confirm}
          name="confirmPassword"
          label="Nhập lại mật khẩu mới"
          autoComplete="new-password"
          required
          disabled={busy}
          value={confirm}
          error={confirmError}
          onChange={(event) => {
            setConfirm(event.target.value);
            setConfirmError(undefined);
          }}
        />
        <Button
          type="submit"
          size="2xl"
          radius="field"
          fullWidth
          loading={busy}
          loadingLabel={navigating ? "Đang chuyển trang…" : "Đang lưu…"}
        >
          Đặt mật khẩu mới
        </Button>
      </form>

      <Link href="/login" className="hidden self-center text-label font-bold text-primary hover:underline lg:block">
        Về đăng nhập
      </Link>
    </AuthCard>
  );
}
