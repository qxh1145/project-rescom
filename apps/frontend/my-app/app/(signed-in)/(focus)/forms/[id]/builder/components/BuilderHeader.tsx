"use client";

import { PILOT_BUILD } from "@/lib/pilot-scope";
import Link from "next/link";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton, IconLink } from "@/components/ui/IconButton";
import { BuilderStepper } from "./BuilderBits";

interface BuilderHeaderProps {
  formId: string;
  title: string;
  statusLine: string;
  saving: boolean;
  onContinue: () => void;
  /** Flushes the autosave, then opens the preview (C4). */
  onPreview: () => void;
  continueBusy: boolean;
  readOnly: boolean;
}

/**
 * Desktop header (63:4222): back to "Khảo sát của tôi", title + autosave
 * status, stepper, "Tạo bằng AI", "Xem trước", "Tiếp tục".
 * Mobile header (69:79): back, title, "Bước 1/3 · Soạn form · …", preview.
 */
export function BuilderHeader({ formId, title, statusLine, saving, onContinue, onPreview, continueBusy, readOnly }: BuilderHeaderProps) {
  const name = title.trim() || "Khảo sát chưa có tên";
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="hidden h-17 items-center gap-4 px-5 lg:flex">
        <IconLink href="/forms" icon="chevron-left" label="Về Khảo sát của tôi" />
        <div className="w-[380px] min-w-0">
          <p className="truncate text-lead font-extrabold text-ink">{name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-muted" aria-live="polite">
            <Icon name={saving ? "loader" : "check-circle"} size={14} className={saving ? "animate-spin" : "text-tone-green-fg"} />
            {statusLine}
          </p>
        </div>
        <div className="flex flex-1 justify-center">
          <BuilderStepper current={0} />
        </div>
        {!readOnly && !PILOT_BUILD ? (
          <Link href={`/forms/${formId}/builder/ai`} className={buttonClassName({ variant: "secondary", size: "md", radius: "field", className: "gap-2 text-label" })}>
            <Icon name="sparkles" size={18} />
            Tạo bằng AI
          </Link>
        ) : null}
        <button type="button" onClick={onPreview} data-tour="builder-preview" className={buttonClassName({ variant: "secondary", size: "md", radius: "field", className: "gap-2 text-label" })}>
          <Icon name="eye" size={18} />
          Xem trước
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={continueBusy}
          aria-busy={continueBusy || undefined}
          className={buttonClassName({ variant: "primary", size: "md", radius: "field", className: "gap-2 text-label" })}
        >
          Tiếp tục
          <Icon name="arrow-right" size={18} />
        </button>
      </div>

      <div className="flex items-center gap-2.5 px-4 pt-3 pb-3 lg:hidden">
        <IconLink href="/forms" icon="chevron-left" label="Về Khảo sát của tôi" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-extrabold text-ink">{name}</p>
          <p className="truncate text-[12px] text-ink-muted" aria-live="polite">
            Bước 1/3 · Soạn form · {statusLine}
          </p>
        </div>
        <IconButton icon="eye" label="Xem trước" onClick={onPreview} />
      </div>
    </header>
  );
}
