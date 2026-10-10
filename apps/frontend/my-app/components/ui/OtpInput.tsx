"use client";

import { useRef } from "react";
import { otpSlots, typeIntoOtp } from "./otp-slots";

interface OtpInputProps {
  /**
   * Fixed-length string, one character per box: a digit or a space for an
   * empty box (`""` = all empty). Complete — digits only — when
   * `isOtpComplete(value, length)` from `./otp-slots`.
   */
  value: string;
  onChange: (value: string) => void;
  length?: number;
  /** Box size: desktop 58.3×64, mobile 44.7×56–58; `responsive` = md below `lg`, lg from `lg` (Google Forms 62:359 / 62:2). */
  size?: "md" | "lg" | "responsive";
  invalid?: boolean;
  disabled?: boolean;
  label: string;
  describedBy?: string;
}

/**
 * Figma "Input – Chữ số 1…6" (5 · Google Forms): one box per digit, paste of
 * the full code fills every box. Digits only; boxes never shift (see `otp-slots.ts`).
 */
export function OtpInput({ value, onChange, length = 6, size = "lg", invalid = false, disabled, label, describedBy }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = otpSlots(value, length);

  const focus = (index: number) => refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  return (
    <div role="group" aria-label={label} aria-describedby={describedBy} className="flex w-full gap-2 sm:gap-2.5">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          autoCapitalize="none"
          spellCheck={false}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          maxLength={length}
          aria-label={`Ký tự ${index + 1}`}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          value={digit}
          // Typing over a filled box replaces its digit.
          onFocus={(event) => event.target.select()}
          onChange={(event) => {
            const next = typeIntoOtp(value, length, index, event.target.value);
            onChange(next.value);
            if (next.focus !== index) focus(next.focus);
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !digit) focus(index - 1);
            if (event.key === "ArrowLeft") focus(index - 1);
            if (event.key === "ArrowRight") focus(index + 1);
          }}
          className={[
            "min-w-0 flex-1 rounded-field border bg-surface text-center font-extrabold text-ink transition-colors",
            "[--focus-ring-color:transparent] focus:border-2 focus:border-primary",
            size === "lg"
              ? "h-16 text-[28px]"
              : size === "responsive"
                ? "h-14 text-[24px] lg:h-16 lg:rounded-control lg:text-[28px]"
                : "h-14 text-[24px]",
            invalid ? "border-2 border-danger" : "border-line-strong",
            "disabled:border-dashed disabled:bg-disabled",
          ].join(" ")}
        />
      ))}
    </div>
  );
}
