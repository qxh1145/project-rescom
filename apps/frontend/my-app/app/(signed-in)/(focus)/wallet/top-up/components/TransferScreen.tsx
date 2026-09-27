"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { TopUpPaymentInstructionsDto } from "@rescom/schemas";
import { FocusError, FocusLoading } from "@/app/(signed-in)/(focus)/_participation/FocusPageState";
import { Alert } from "@/components/ui/Alert";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { copyTextToClipboard } from "@/lib/clipboard";
import { copyableVnd, formatPoints, formatVnd, topUpStatusPath } from "@/lib/wallet/top-up";
import { COPY_FAILED_MESSAGE, loadTopUpErrorMessage } from "@/lib/wallet/wallet-messages";
import { useTopUpRequest } from "../hooks/use-top-up-request";
import { TopUpFrame } from "./TopUpFrame";

interface CopyField {
  key: string;
  label: string;
  value: string;
  copyValue: string;
  /** 18px extra-bold (account number, amount) vs 15px bold. */
  emphasis: boolean;
}

function fieldsOf(instructions: TopUpPaymentInstructionsDto): CopyField[] {
  return [
    { key: "bank", label: "Ngân hàng", value: instructions.bankName, copyValue: instructions.bankName, emphasis: false },
    {
      key: "account",
      label: "Số tài khoản",
      value: instructions.accountNumber,
      copyValue: instructions.accountNumber,
      emphasis: true,
    },
    { key: "holder", label: "Chủ tài khoản", value: instructions.accountName, copyValue: instructions.accountName, emphasis: false },
    {
      key: "amount",
      label: "Số tiền",
      value: formatVnd(instructions.amountVnd),
      copyValue: copyableVnd(instructions.amountVnd),
      emphasis: true,
    },
  ];
}

const REFERENCE_LABEL = "Nội dung chuyển khoản · ghi đúng để được duyệt nhanh";

function CopyButton({ label, copied, onClick }: { label: string; copied: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Sao chép ${label.toLowerCase()}`}
      className="inline-flex h-10 w-[113px] shrink-0 items-center justify-center gap-2 rounded-field border border-line-strong bg-surface text-caption font-bold text-ink transition-colors hover:bg-surface-subtle"
    >
      <Icon name={copied ? "check" : "copy"} size={16} />
      {copied ? "Đã chép" : "Sao chép"}
    </button>
  );
}

/**
 * VietQR slot (Figma 62:3630). The backend returns the EMVCo `qrPayload`,
 * but no QR encoder is bundled yet, so the dashed placeholder stays
 * (ASSUMED / follow-up).
 */
function QrPlaceholder() {
  return (
    <div
      role="img"
      aria-label="Mã VietQR (chưa hiển thị — chuyển thủ công theo thông tin bên cạnh)"
      className="flex size-[170px] items-center justify-center rounded-control border border-dashed border-line-strong bg-surface-subtle text-caption text-ink-muted"
    >
      [Mã VietQR]
    </div>
  );
}

/**
 * Figma 14b "Nạp điểm · chuyển khoản" — desktop dialog 62:3623 (720px, QR
 * left, fields right), mobile 62:3873. "Tôi đã chuyển khoản" only moves to
 * 14c: the backend has no "paid" confirmation — the request is already
 * PENDING for Admin review since it was created (ASSUMED).
 */
export function TransferScreen() {
  const router = useRouter();
  const { id, request, error, reload } = useTopUpRequest();
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const instructions = request?.status === "PENDING" ? request.paymentInstructions : null;
  const reviewed = request !== null && !instructions;
  useEffect(() => {
    if (reviewed) router.replace(topUpStatusPath(id));
  }, [reviewed, router, id]);
  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  async function copy(key: string, value: string) {
    const ok = await copyTextToClipboard(value);
    setCopyFailed(!ok);
    setCopied(ok ? key : null);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    if (ok) resetTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  if (error && !request) {
    return (
      <FocusError
        title="Chưa mở được thông tin chuyển khoản"
        message={loadTopUpErrorMessage(error)}
        onRetry={reload}
        backHref="/wallet"
        backLabel="Về Ví điểm"
      />
    );
  }
  if (!request || !instructions) return <FocusLoading />;

  const statusHref = topUpStatusPath(request.id);
  const points = formatPoints(request.amount);
  const copiedLabel = copied === "reference" ? "nội dung chuyển khoản" : fieldsOf(instructions).find((f) => f.key === copied)?.label;

  return (
    <TopUpFrame
      mobileTitle="Chuyển khoản"
      exitHref="/wallet"
      width={720}
      desktopHeader={
        <>
          <h1 id="top-up-dialog-title" className="text-[22px] font-extrabold text-ink">
            Chuyển khoản để nạp {points} điểm
          </h1>
          <p className="mt-1 text-body-sm text-ink-muted">
            Chuyển đúng số tiền và nội dung, rồi bấm &quot;Tôi đã chuyển khoản&quot;.
          </p>
        </>
      }
      mobileFooter={
        <Link href={statusHref} className={buttonClassName({ size: "lg", radius: "field", fullWidth: true })}>
          Tôi đã chuyển khoản
        </Link>
      }
    >
      <p className="sr-only" aria-live="polite">
        {copiedLabel ? `Đã sao chép ${copiedLabel.toLowerCase()}` : ""}
      </p>
      <div className="flex flex-col lg:mt-5 lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-6">
        <div className="flex flex-col items-center">
          <QrPlaceholder />
          <p className="mt-2 max-w-[350px] text-center text-caption text-ink-muted lg:text-[12px]">
            <span className="lg:hidden">Quét bằng app ngân hàng, hoặc chuyển thủ công theo thông tin dưới đây</span>
            <span className="hidden lg:inline">Quét bằng app ngân hàng</span>
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-line bg-surface px-3.5 pt-1 pb-3.5 lg:mt-0 lg:rounded-none lg:border-0 lg:p-0">
          <div className="flex flex-col gap-2.5">
            {fieldsOf(instructions).map((field) => (
              <div key={field.key} className="flex min-h-[61px] items-center gap-3 border-b border-line-subtle pb-1">
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold text-ink-muted">{field.label}</p>
                  <p className={`break-words text-ink ${field.emphasis ? "text-[18px] font-extrabold" : "text-body font-bold"}`}>
                    {field.value}
                  </p>
                </div>
                <CopyButton label={field.label} copied={copied === field.key} onClick={() => copy(field.key, field.copyValue)} />
              </div>
            ))}
            <div className="flex min-h-[75px] items-center gap-3 rounded-field bg-tone-amber-bg px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-tone-amber-fg">{REFERENCE_LABEL}</p>
                <p className="mt-1 break-all text-[18px] font-extrabold tracking-[0.5px] text-ink">
                  {instructions.transferContent}
                </p>
              </div>
              <CopyButton
                label="nội dung chuyển khoản"
                copied={copied === "reference"}
                onClick={() => copy("reference", instructions.transferContent)}
              />
            </div>
          </div>
        </div>
      </div>

      {copyFailed ? (
        <Alert tone="danger" className="mt-4" onDismiss={() => setCopyFailed(false)}>
          {COPY_FAILED_MESSAGE}
        </Alert>
      ) : null}

      <div className="mt-4 flex items-start gap-2.5 rounded-field bg-surface-subtle px-3.5 py-3 lg:hidden">
        <Icon name="info" size={18} className="mt-px text-ink-muted" />
        <p className="text-caption-relaxed text-ink-strong">
          Chuyển xong thì bấm nút bên dưới. Admin đối chiếu theo nội dung chuyển khoản và cộng {points} điểm vào Ví, bạn
          sẽ nhận thông báo.
        </p>
      </div>

      <div className="mt-[18px] hidden items-center gap-3 border-t border-line-subtle pt-4 lg:flex">
        <p className="flex-1 text-[12px] leading-[18px] text-ink-muted">
          Admin đối chiếu thủ công. Nạp là một chiều, không hoàn tiền, không chuyển cho tài khoản khác.
        </p>
        <Link href="/wallet" className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}>
          Để sau
        </Link>
        <Link href={statusHref} className={buttonClassName({ size: "base", radius: "field" })}>
          Tôi đã chuyển khoản
        </Link>
      </div>
    </TopUpFrame>
  );
}
