"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { AUTH_MESSAGES } from "@/lib/auth/auth-error-messages";
import { clearPendingEmail, readPendingEmail, subscribePendingEmail } from "@/lib/auth/pending-email";
import { AuthCard } from "../../login/components/AuthCard";
import { AuthFormAlert } from "../../login/components/AuthFormAlert";
import { usePasswordResetRequest } from "../hooks/use-password-reset-request";

const readEmail = () => readPendingEmail("password-reset");
const noEmailOnServer = () => null;

/**
 * 15c "Kiểm tra hộp thư" — Figma `63:2089` (mobile; desktop card ASSUMED).
 * The copy never confirms that the account exists. Without a remembered email
 * (page opened directly) the generic copy is shown and "Gửi lại email" goes
 * back to the form.
 */
export function ResetLinkSentPanel() {
  const email = useSyncExternalStore(subscribePendingEmail, readEmail, noEmailOnServer);
  const reset = usePasswordResetRequest();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleResend() {
    if (!email) return;
    setNotice(null);
    setError(null);
    const result = await reset.send(email);
    if (!result) return;
    if (result.ok) setNotice(AUTH_MESSAGES.passwordResetResent);
    else setError(result.error.form ?? result.error.fields?.email ?? AUTH_MESSAGES.server);
  }

  return (
    <AuthCard className="flex-1 lg:flex-none">
      <div className="flex flex-col items-center px-1 pt-5 text-center lg:pt-0">
        <span className="flex size-18 items-center justify-center rounded-[22px] bg-tone-green-bg text-tone-green-fg">
          <Icon name="mail" size={36} />
        </span>
        <h2 className="mt-3.5 text-title-sm font-extrabold text-ink">Đã gửi yêu cầu</h2>
        <p className="mt-3.5 text-body-relaxed text-ink-strong">
          Nếu {email ? <strong className="font-bold">{email}</strong> : "email của bạn"} có tài khoản
          Rescom, bạn sẽ nhận email kèm link đặt lại mật khẩu. Nhớ kiểm tra cả thư mục Spam.
        </p>
      </div>

      {notice ? <Alert tone="info" onDismiss={() => setNotice(null)}>{notice}</Alert> : null}
      {error ? <AuthFormAlert>{error}</AuthFormAlert> : null}

      <div className="mt-auto flex flex-col gap-2.5 pt-8 lg:mt-2 lg:pt-0">
        {/* Leaving the flow: the email must not linger in sessionStorage. */}
        <Link
          href="/login"
          onClick={() => clearPendingEmail("password-reset")}
          className={buttonClassName({ size: "lg", radius: "field", fullWidth: true })}
        >
          Về đăng nhập
        </Link>
        {email ? (
          <Button
            variant="secondary"
            size="base"
            radius="field"
            fullWidth
            loading={reset.busy}
            loadingLabel="Đang gửi lại…"
            onClick={handleResend}
          >
            Gửi lại email
          </Button>
        ) : (
          <Link
            href="/forgot-password"
            className={buttonClassName({ variant: "secondary", size: "base", radius: "field", fullWidth: true })}
          >
            Gửi lại email
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
