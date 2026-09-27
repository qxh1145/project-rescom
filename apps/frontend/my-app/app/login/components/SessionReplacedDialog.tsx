"use client";

import Link from "next/link";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { sessionReplacedMessage } from "@/lib/auth/auth-error-messages";

interface SessionReplacedDialogProps {
  open: boolean;
  /** When the other device signed in, if known. */
  at: Date | null;
  onSignInAgain: () => void;
}

const TITLE_ID = "session-replaced-title";

/**
 * 15e "Bạn đã được đăng xuất" — Figma `63:3001` (desktop, 480px) / `63:3065`
 * (mobile). Drawn over the dimmed login page; Esc does not dismiss an alertdialog.
 */
export function SessionReplacedDialog({ open, at, onSignInAgain }: SessionReplacedDialogProps) {
  return (
    <Dialog open={open} onClose={onSignInAgain} labelledBy={TITLE_ID} role="alertdialog" width={480}>
      <div className="flex flex-col items-center px-6 pb-7 pt-7 text-center">
        <span className="flex size-16 items-center justify-center rounded-[20px] bg-tone-amber-bg text-tone-amber-fg">
          <Icon name="smartphone" size={30} />
        </span>
        <h2 id={TITLE_ID} className="mt-3 text-title-sm font-extrabold text-ink">
          Bạn đã được đăng xuất
        </h2>
        <p className="mt-3 text-body-relaxed text-ink-strong">{sessionReplacedMessage(at)}</p>
        <p className="mt-3 text-caption-relaxed text-ink-muted">
          Câu trả lời đã nộp và điểm của bạn vẫn được giữ nguyên.
        </p>
        <div className="mt-4.5 flex w-full flex-col gap-2">
          <Button size="lg" radius="field" fullWidth onClick={onSignInAgain}>
            Đăng nhập lại
          </Button>
          <Link
            href="/forgot-password"
            className={buttonClassName({ variant: "secondary", size: "base", radius: "field", fullWidth: true })}
          >
            Không phải bạn? Đổi mật khẩu
          </Link>
        </div>
      </div>
    </Dialog>
  );
}
