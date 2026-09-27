import type { ComponentPropsWithRef, ReactNode } from "react";

export type AlertTone = "danger" | "info";

const TONE_CLASSES: Record<AlertTone, string> = {
  danger: "border-danger/30 bg-danger-soft text-danger",
  info: "border-line bg-info-soft text-ink",
};

interface AlertProps extends Omit<ComponentPropsWithRef<"div">, "role"> {
  tone: AlertTone;
  children: ReactNode;
  onDismiss?: () => void;
}

/** Inline form-level message. `danger` is announced immediately (`role="alert"`). */
export function Alert({ tone, children, onDismiss, className = "", ...props }: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      tabIndex={-1}
      className={`flex items-start gap-3 rounded-field border px-3.5 py-3 text-body-sm focus:outline-none ${TONE_CLASSES[tone]} ${className}`}
      {...props}
    >
      <p className="flex-1">{children}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Đóng thông báo"
          className="-m-1 rounded-md p-1 leading-none opacity-70 hover:opacity-100"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </div>
  );
}
