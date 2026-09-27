import type { CSSProperties } from "react";
import type { FormBlockType } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { blockTypeInfo } from "@/lib/forms/builder-catalog";

/**
 * Small Figma 13 pieces shared by the builder screens.
 * `ShapeIcon` renders a non-square icon (grip dots 6.13×10.13, undo 13.7×16)
 * as a mask like `Icon`, which only knows square boxes.
 */
export function ShapeIcon({ name, width, height, className = "" }: { name: string; width: number; height: number; className?: string }) {
  const url = `url("/icons/${name}.svg")`;
  const style: CSSProperties = {
    width,
    height,
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
  return <span aria-hidden="true" className={`inline-block shrink-0 bg-current ${className}`} style={style} />;
}

/** Figma grip: 16/18px frame with the dots group inset 18.33% × 30.83%. */
export function GripIcon({ size = 18, className = "text-ink-muted" }: { size?: number; className?: string }) {
  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <ShapeIcon name="grip-dots" width={size * 0.3834} height={size * 0.6334} className={className} />
    </span>
  );
}

/** Figma "Input" switch: 44×26, primary when on, `line-strong` when off. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  id,
  size = "md",
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  id: string;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-px h-6.5 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
          checked ? "bg-primary" : "bg-line-strong"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.75 size-5 rounded-full bg-surface transition-[left] ${checked ? "left-5.25" : "left-0.75"}`}
        />
      </button>
      <span className="flex min-w-0 flex-col gap-0.5 pt-0.5">
        <label htmlFor={id} className={`font-semibold text-ink ${size === "sm" ? "text-caption" : "text-body-sm"}`}>
          {label}
        </label>
        {description ? (
          <span id={`${id}-desc`} className="text-[12px] leading-[17.4px] font-medium text-ink-muted">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** Question type pill ("⦿ Một lựa chọn"): 24px, `surface-subtle`. */
export function TypeChip({ type, compact = false }: { type: FormBlockType; compact?: boolean }) {
  const info = blockTypeInfo(type);
  return (
    <span className="inline-flex h-6 items-center gap-1.25 rounded-full bg-surface-subtle pr-2 pl-2 text-[12px] font-bold text-ink-strong">
      <Icon name={info.icon} size={compact ? 12 : 13} />
      {info.label}
    </span>
  );
}

export function AttentionChip({ pending = false, short = false }: { pending?: boolean; short?: boolean }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.25 rounded-full bg-tone-amber-bg pr-2.5 pl-2 text-[12px] font-bold text-tone-amber-fg">
      <Icon name="shield-check" size={13} />
      {short ? "Kiểm tra" : pending ? "Gợi ý kiểm tra chú ý · chờ xác nhận" : "Kiểm tra chú ý"}
    </span>
  );
}

export function AiChip() {
  return (
    <span className="inline-flex h-6 items-center gap-1.25 rounded-full bg-tone-blue-bg pr-2.5 pl-2 text-[12px] font-bold text-tone-blue-fg">
      <Icon name="sparkles" size={12} />
      AI
    </span>
  );
}

/** "Phần 1" pill of a section header. */
export function SectionPill({ number, small = false }: { number: number; small?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-ink px-2.5 font-extrabold text-surface ${
        small ? "h-6 text-[12px]" : "h-6.5 text-caption"
      }`}
    >
      Phần {number}
    </span>
  );
}

/** 36px round icon action on a card ("Nhân bản", "Xoá", move up/down); 44px on touch screens. */
export function ToolButton({
  icon,
  label,
  onClick,
  disabled = false,
  danger = false,
  rotate = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  rotate?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-11 items-center justify-center rounded-full text-ink-muted transition-colors disabled:opacity-40 lg:size-9 ${
        danger ? "hover:bg-danger-soft hover:text-danger" : "hover:bg-surface-subtle hover:text-ink"
      }`}
    >
      <Icon name={icon} size={18} className={rotate ? "rotate-180" : ""} />
    </button>
  );
}

export const BUILDER_STEPS = ["Soạn form", "Đối tượng", "Số mẫu & điểm"] as const;

/** Header stepper "1 Soạn form — 2 Đối tượng — 3 Số mẫu & điểm" (63:4231…63:4241). */
export function BuilderStepper({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Các bước tạo khảo sát">
      {BUILDER_STEPS.map((label, i) => (
        <li key={label} className="flex items-center gap-2" aria-current={i === current ? "step" : undefined}>
          {i > 0 ? <span aria-hidden="true" className="mr-0.5 h-0.5 w-5 bg-line" /> : null}
          <span
            className={`flex size-5.5 items-center justify-center rounded-full text-[12px] font-extrabold ${
              i <= current ? "bg-primary text-surface" : "bg-line text-ink-muted"
            }`}
          >
            {i < current ? <Icon name="check-bold" size={12} /> : i + 1}
          </span>
          <span className={`text-caption ${i === current ? "font-bold text-tone-green-fg" : "font-semibold text-ink-muted"}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
