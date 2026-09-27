"use client";

import { useState } from "react";
import { Icon } from "./Icon";
import { TextField, type TextFieldProps } from "./TextField";

type PasswordFieldProps = Omit<TextFieldProps, "type" | "endSlot">;

/** `TextField` for passwords with an eye toggle that shows/hides the typed value. */
export function PasswordField({ id, disabled, ...props }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <TextField
      id={id}
      disabled={disabled}
      {...props}
      type={visible ? "text" : "password"}
      endSlot={
        <button
          type="button"
          aria-label="Hiện mật khẩu"
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          onClick={() => setVisible((current) => !current)}
          className="inline-flex size-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name={visible ? "eye-off" : "eye"} size={18} />
        </button>
      }
    />
  );
}
