import type { ComponentPropsWithRef, ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";

interface AuthFormAlertProps extends Omit<ComponentPropsWithRef<"div">, "role" | "children"> {
  children: ReactNode;
}

/**
 * Form-level error of the page 15 screens — Figma "alert" `63:3996`: 1px danger
 * border on danger-soft, 18px alert icon, 14px semibold dark-red copy. Focusable
 * so the form can move focus to it after a failed submit.
 */
export function AuthFormAlert({ children, className = "", ...props }: AuthFormAlertProps) {
  return (
    <div
      role="alert"
      tabIndex={-1}
      className={`flex items-start gap-2.5 rounded-control border border-danger bg-danger-soft py-3 pl-3.5 pr-8.5 text-label font-semibold text-danger-strong focus:outline-none ${className}`}
      {...props}
    >
      <Icon name="alert-circle" size={18} />
      <p className="flex-1">{children}</p>
    </div>
  );
}
