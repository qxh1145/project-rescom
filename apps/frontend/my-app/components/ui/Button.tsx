import type { ComponentPropsWithRef, ReactNode } from "react";
import { Spinner } from "./Spinner";

/**
 * Page 8 (62:1477): primary = "Nút chính", secondary = "Nút phụ" (neutral
 * outline), outline = green outline (login Google button), ghost = text-only.
 */
export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger" | "danger-outline";
/** Heights in px: sm 40 · md 44 · base 48 · lg 52 · xl 54 · 2xl 56 (17px label, page 15 CTAs). */
export type ButtonSize = "sm" | "md" | "base" | "lg" | "xl" | "2xl";
/** Corner radius: control 14px (default) · field 12px (page 15 buttons and dialogs). */
export type ButtonRadius = "control" | "field";

interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  radius?: ButtonRadius;
  fullWidth?: boolean;
  className?: string;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed",
  secondary:
    "border border-line-strong bg-surface text-ink hover:border-ink-muted hover:bg-surface-subtle active:border-ink-muted active:bg-line",
  outline: "border border-primary bg-surface text-primary hover:bg-primary/5 active:bg-primary/10",
  ghost: "text-primary hover:bg-tone-green-bg active:bg-tone-green-bg",
  danger: "bg-danger text-primary-foreground hover:brightness-95 active:brightness-90",
  // Admin 11a "Từ chối…" (62:3513): white fill, 1px danger border and label.
  "danger-outline": "border border-danger bg-surface text-danger hover:bg-danger-soft active:bg-danger-soft",
};

// Page 8 "Không dùng được": dashed control border, #EEF1F6 fill, #3A4460 text.
// A busy button is disabled too but keeps its fill ("Đang xử lý"), hence `not-aria-busy`.
const DISABLED_CLASSES =
  "disabled:cursor-not-allowed disabled:not-aria-busy:border disabled:not-aria-busy:border-dashed disabled:not-aria-busy:border-line-strong disabled:not-aria-busy:bg-disabled disabled:not-aria-busy:text-disabled-foreground disabled:not-aria-busy:brightness-100 " +
  "aria-disabled:pointer-events-none aria-disabled:border aria-disabled:border-dashed aria-disabled:border-line-strong aria-disabled:bg-disabled aria-disabled:text-disabled-foreground";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-10 px-4 text-label",
  md: "h-11 px-4.5 text-body",
  base: "h-12 px-5 text-body",
  lg: "h-13 px-5 text-button",
  xl: "h-13.5 px-5 text-button",
  "2xl": "h-14 px-5 text-button-lg",
};

export function buttonClassName({
  variant = "primary",
  size = "lg",
  radius = "control",
  fullWidth = false,
  className = "",
}: ButtonStyleOptions = {}): string {
  return [
    "inline-flex items-center justify-center gap-2.5 font-bold transition-colors",
    radius === "field" ? "rounded-field" : "rounded-control",
    VARIANT_CLASSES[variant],
    DISABLED_CLASSES,
    SIZE_CLASSES[size],
    fullWidth ? "w-full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

interface ButtonProps extends ComponentPropsWithRef<"button">, Omit<ButtonStyleOptions, "className"> {
  loading?: boolean;
  /** Replaces the children while `loading`. */
  loadingLabel?: ReactNode;
  leadingIcon?: ReactNode;
}

export function Button({
  variant,
  size,
  radius,
  fullWidth,
  loading = false,
  loadingLabel,
  leadingIcon,
  className,
  disabled,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName({ variant, size, radius, fullWidth, className })}
      {...props}
    >
      {loading ? <Spinner /> : leadingIcon}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}

interface ButtonLinkProps extends ComponentPropsWithRef<"a">, Omit<ButtonStyleOptions, "className"> {
  href: string;
  leadingIcon?: ReactNode;
  disabled?: boolean;
}

/**
 * Plain `<a>` with button styling — for full-page navigations that leave the
 * React tree (e.g. the OAuth redirect). Use `next/link` for in-app routes.
 */
export function ButtonLink({
  variant,
  size,
  radius,
  fullWidth,
  leadingIcon,
  className,
  disabled = false,
  href,
  children,
  ...props
}: ButtonLinkProps) {
  // Without `href` a disabled link cannot be followed, even from a screen reader's virtual cursor.
  return (
    <a
      href={disabled ? undefined : href}
      role={disabled ? "link" : undefined}
      aria-disabled={disabled || undefined}
      className={buttonClassName({ variant, size, radius, fullWidth, className })}
      {...props}
    >
      {leadingIcon}
      <span>{children}</span>
    </a>
  );
}
