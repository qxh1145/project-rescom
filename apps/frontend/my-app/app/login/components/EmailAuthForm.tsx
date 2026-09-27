import Link from "next/link";
import type { FormEvent, Ref } from "react";
import { Button } from "@/components/ui/Button";
import { PasswordField } from "@/components/ui/PasswordField";
import { TextField } from "@/components/ui/TextField";
import type {
  AuthSubmitStatus,
  EmailAuthField,
  EmailAuthFieldErrors,
  EmailAuthFormValues,
} from "@/lib/auth/types";

interface EmailAuthFormProps {
  values: EmailAuthFormValues;
  fieldErrors: EmailAuthFieldErrors;
  status: AuthSubmitStatus;
  emailRef: Ref<HTMLInputElement>;
  passwordRef: Ref<HTMLInputElement>;
  onFieldChange: (field: EmailAuthField, value: string) => void;
  onSubmit: () => void;
}

/**
 * Email sign-in form of `/login`. Controlled by `LoginPanel` so demo
 * credentials can be filled in from outside. Registration lives on `/register`.
 */
export function EmailAuthForm({
  values,
  fieldErrors,
  status,
  emailRef,
  passwordRef,
  onFieldChange,
  onSubmit,
}: EmailAuthFormProps) {
  const busy = status !== "idle";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4 lg:gap-5">
      <TextField
        ref={emailRef}
        id="auth-email"
        name="email"
        type="email"
        label="Email"
        placeholder="ban@fpt.edu.vn"
        autoComplete="email"
        inputMode="email"
        required
        disabled={busy}
        value={values.email}
        error={fieldErrors.email}
        onChange={(event) => onFieldChange("email", event.target.value)}
      />
      <div className="flex flex-col gap-2">
        <PasswordField
          ref={passwordRef}
          id="auth-password"
          name="password"
          label="Mật khẩu"
          placeholder="••••••••"
          autoComplete="current-password"
          required
          disabled={busy}
          value={values.password}
          error={fieldErrors.password}
          onChange={(event) => onFieldChange("password", event.target.value)}
        />
        {/* Figma `62:466` (mobile). The desktop frame has no link; shown there too (ASSUMED). */}
        <Link
          href="/forgot-password"
          className="self-end text-label font-bold text-primary hover:underline"
        >
          Quên mật khẩu?
        </Link>
      </div>
      <Button
        type="submit"
        variant="outline"
        size="xl"
        fullWidth
        loading={busy}
        loadingLabel="Đang đăng nhập…"
      >
        Đăng nhập bằng email
      </Button>
    </form>
  );
}
