"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { PAUSE_SUPPORTED, type PublisherForm } from "@/lib/forms/manage-service";
import { canReopen, canWithdraw, resubmitHref, statusViewOf } from "@/lib/forms/manage-status";
import { useFormActions } from "../hooks/use-form-actions";

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-field border px-4 text-label font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const NEUTRAL = "border-line-strong bg-surface text-ink hover:bg-surface-subtle";
/** Figma buttons are 44px; links 46px ("Mở Google Form", "Mở lại thêm mẫu"). */
const SECONDARY = `${BASE} h-11 ${NEUTRAL}`;
const SECONDARY_LINK = `${BASE} h-11.5 ${NEUTRAL}`;
const OUTLINE = `${BASE} h-11.5 border-primary bg-surface text-primary hover:bg-primary/5`;
const PRIMARY = `${BASE} h-11 border-primary bg-primary text-primary-foreground hover:bg-primary-hover`;

/**
 * Header actions by status — Figma 10a (Google Forms, running: Mở Google Form ·
 * Tạm dừng · Đóng & hoàn điểm) and 17 (Form Builder, full: Mở lại thêm mẫu ·
 * Xuất dữ liệu). Other combinations are ASSUMED from those two. "Tạm dừng"
 * waits for a backend route (`PAUSE_SUPPORTED`, Phase 5 M3); "Rút lại & hoàn
 * điểm" covers a survey waiting for review and a re-versioned draft (M7).
 */
export function HeaderActions({ form, className = "" }: { form: PublisherForm; className?: string }) {
  const { requestClose, togglePause, pausing } = useFormActions();
  const view = statusViewOf(form);
  const id = encodeURIComponent(form.id);
  const live = view === "RUNNING" || view === "PAUSED";
  const ended = view === "FULL" || view === "ENDED";
  const externalUrl = form.type === "EXTERNAL" ? form.currentVersion.externalUrl : null;

  if (view === "REJECTED") {
    return (
      <div className={`flex flex-wrap gap-2.5 ${className}`}>
        <Link href={resubmitHref(form)} scroll={false} className={SECONDARY_LINK}>
          Sửa &amp; gửi lại
        </Link>
      </div>
    );
  }

  return (
    <div className={`flex flex-wrap gap-2.5 ${className}`}>
      {externalUrl && (live || ended) ? (
        <a href={externalUrl} target="_blank" rel="noopener noreferrer" className={SECONDARY_LINK}>
          <Icon name="external-link" size={16} />
          Mở Google Form
        </a>
      ) : null}
      {live ? (
        <>
          {PAUSE_SUPPORTED ? (
            <button type="button" className={SECONDARY} onClick={togglePause} disabled={pausing} aria-busy={pausing || undefined}>
              <Icon name={form.pausedAt ? "play-circle" : "pause"} size={16} />
              {form.pausedAt ? "Tiếp tục" : "Tạm dừng"}
            </button>
          ) : null}
          <button type="button" className={SECONDARY} onClick={requestClose}>
            Đóng &amp; hoàn điểm
          </button>
        </>
      ) : null}
      {canWithdraw(form, form.currentVersion.versionNumber) ? (
        <button type="button" className={SECONDARY} onClick={requestClose}>
          Rút lại &amp; hoàn điểm
        </button>
      ) : null}
      {ended && canReopen(form) ? (
        <Link href={`/forms/${id}/reopen`} scroll={false} className={OUTLINE}>
          Mở lại thêm mẫu
        </Link>
      ) : null}
      {form.type === "INTERNAL" && (live || ended) ? (
        <Link href={`/forms/${id}/export`} className={PRIMARY}>
          <Icon name="download" size={18} />
          Xuất dữ liệu
        </Link>
      ) : null}
    </div>
  );
}
