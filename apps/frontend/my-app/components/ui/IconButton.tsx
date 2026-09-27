import type { ComponentPropsWithRef } from "react";
import Link from "next/link";
import { Icon, type IconName } from "./Icon";

const CLASSES =
  "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink transition-colors hover:bg-line";

interface IconButtonProps extends ComponentPropsWithRef<"button"> {
  icon: IconName;
  label: string;
  iconSize?: number;
}

/** 44px round control on #F1F4F9 (Figma "Link – Quay lại", "Link – Đóng", bell). */
export function IconButton({ icon, label, iconSize = 20, className = "", type = "button", children, ...props }: IconButtonProps) {
  return (
    <button type={type} aria-label={label} className={`${CLASSES} ${className}`} {...props}>
      <Icon name={icon} size={iconSize} />
      {children}
    </button>
  );
}

interface IconLinkProps extends Omit<ComponentPropsWithRef<typeof Link>, "children"> {
  icon: IconName;
  label: string;
  iconSize?: number;
  children?: React.ReactNode;
}

export function IconLink({ icon, label, iconSize = 20, className = "", children, ...props }: IconLinkProps) {
  return (
    <Link aria-label={label} className={`${CLASSES} ${className}`} {...props}>
      <Icon name={icon} size={iconSize} />
      {children}
    </Link>
  );
}
