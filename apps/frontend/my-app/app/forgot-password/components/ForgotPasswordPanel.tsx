"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { TextField } from "@/components/ui/TextField";
import { clearPendingEmail, savePendingEmail } from "@/lib/auth/pending-email";
import { AuthCard } from "../../login/components/AuthCard";
import { AuthFormAlert } from "../../login/components/AuthFormAlert";
import { usePasswordResetRequest } from "../hooks/use-password-reset-request";

/** 15b "Quên mật khẩu" — Figma `63:1973` (mobile only; desktop card ASSUMED (design)). */
export function ForgotPasswordPanel() {
  const router = useRouter();
  const reset = usePasswordResetRequest();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ target: "email" | "form" } | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const busy = reset.busy || navigating;

  // A new request replaces whatever an earlier one left for 15c.
  useEffect(() => {
    clearPendingEmail("password-reset");
  }, []);

  useEffect(() => {
    if (!focusRequest) return;
    (focusRequest.target === "email" ? emailRef : alertRef).current?.focus();
  }, [focusRequest]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const result = await reset.send(email);
    if (!result) return;
    if (result.ok) {
      setNavigating(true);
      savePendingEmail("password-reset", result.email);
      router.push("/forgot-password/sent");
      return;
    }
    setEmailError(result.error.fields?.email);
    setFormError(result.error.form ?? null);
    setFocusRequest({ target: result.error.fields?.email ? "email" : "form" });
  }

  return (
    <AuthCard title="Quên mật khẩu" spacing="lg">
      <p className="text-body-relaxed text-ink-strong">
        Nhập email bạn dùng để đăng ký. Rescom sẽ gửi link đặt lại mật khẩu.
      </p>

      {formError ? <AuthFormAlert ref={alertRef}>{formError}</AuthFormAlert> : null}

      <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4.5">
        <TextField
          ref={emailRef}
          id="forgot-email"
          name="email"
          type="email"
          label="Email"
          placeholder="ban@fpt.edu.vn"
          autoComplete="email"
          inputMode="email"
          required
          disabled={busy}
          value={email}
          error={emailError}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(undefined);
          }}
        />
        <Button type="submit" size="2xl" radius="field" fullWidth loading={busy} loadingLabel="Đang gửi…">
          Gửi link đặt lại
        </Button>
      </form>

      <div className="flex items-start gap-2.5 rounded-field bg-surface-subtle px-3.5 py-3">
        <Icon name="info" size={18} className="mt-px text-ink-muted" />
        <p className="text-caption-relaxed text-ink-strong">
          Nếu bạn đăng ký bằng Google, hãy quay lại và chọn &quot;Tiếp tục với Google&quot;, không cần mật
          khẩu.
        </p>
      </div>

      {/* Desktop has no back bar (ASSUMED). */}
      <Link
        href="/login"
        onClick={() => clearPendingEmail("password-reset")}
        className="hidden self-center text-label font-bold text-primary hover:underline lg:block"
      >
        Về đăng nhập
      </Link>
    </AuthCard>
  );
}
