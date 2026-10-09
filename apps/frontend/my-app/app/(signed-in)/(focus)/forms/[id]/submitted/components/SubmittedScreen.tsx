"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { AppHeader } from "@/components/layout/app/AppHeader";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { CLIPBOARD_COPY_FAILED_MESSAGE, copyTextToClipboard } from "@/lib/clipboard";
import { completionCodeLine } from "@/lib/forms/create-messages";
import { browserStorage, clearSubmittedSurvey, readSubmittedSurvey, type SubmittedSurvey } from "@/lib/forms/create-storage";
import { useSession } from "@/lib/session/SessionProvider";

const MY_SURVEYS_HREF = "/forms";

/**
 * `/forms/:id/submitted` — Figma 9d "Đã gửi duyệt + mã hoàn thành" (62:2708
 * desktop, 62:3015 mobile). The six-digit code comes from the
 * `POST /forms/external` response kept in sessionStorage by the wizard: the
 * backend discloses it once and refuses a rotation while the survey is in
 * moderation (409 `FORM_IN_MODERATION`), so without it the screen explains
 * that the code is no longer shown (ASSUMED (design) state, not drawn).
 */
export function SubmittedScreen() {
  const { id } = useParams<{ id: string }>();
  const { user } = useSession();
  // SessionGate renders this only in the browser, once signed in.
  const [survey] = useState<SubmittedSurvey | null>(() =>
    readSubmittedSurvey(browserStorage("session"), id, user?.id ?? ""),
  );

  return (
    <>
      <AppHeader />
      <main className="flex flex-1 flex-col">
        {survey ? <CodeView survey={survey} /> : <CodeGoneView formId={id} />}
      </main>
    </>
  );
}

function StatusPills({ escrowPoints }: { escrowPoints: number }) {
  return (
    <div className="flex flex-wrap justify-center gap-2 lg:justify-start">
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-subtle px-2.5 text-[12px] font-bold text-ink-strong lg:h-7.5 lg:px-3 lg:text-[13px]">
        <Icon name="clock" size={14} />
        Chờ duyệt
      </span>
      <span className="inline-flex h-7 items-center rounded-full bg-tone-amber-bg px-3 text-[12px] font-bold text-tone-amber-fg lg:h-7.5 lg:text-[13px]">
        {escrowPoints} điểm đã vào Ký quỹ
      </span>
    </div>
  );
}

function CodeView({ survey }: { survey: SubmittedSurvey }) {
  const router = useRouter();
  const line = completionCodeLine(survey.completionCode);
  // Official surveys (ADMIN) are published at once and never lock Ký quỹ.
  const official = survey.escrowPoints === 0;
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [confirmed, setConfirmed] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function copy() {
    const copied = await copyTextToClipboard(line);
    setCopyState(copied ? "copied" : "failed");
    clearTimeout(resetTimer.current);
    if (copied) resetTimer.current = setTimeout(() => setCopyState("idle"), 2500);
  }

  function finish() {
    clearSubmittedSurvey(browserStorage("session"), survey.formId);
    router.push(MY_SURVEYS_HREF);
  }

  return (
    <div className="mx-auto flex w-full max-w-[962px] flex-1 flex-col lg:px-0 lg:pt-10 lg:pb-12">
      <div className="flex flex-col items-center gap-2.5 bg-surface px-5 pt-[max(env(safe-area-inset-top),52px)] pb-5 text-center lg:flex-row lg:gap-6.5 lg:bg-transparent lg:p-0 lg:text-left">
        <Mascot name="create" height={120} />
        <div className="flex flex-col gap-3 lg:gap-3.5">
          <h1 className="text-[22px] leading-[28.6px] font-extrabold text-ink lg:text-[30px] lg:leading-normal lg:tracking-[-0.3px]">
            {official ? "Đã đăng khảo sát chính thức" : "Đã gửi khảo sát cho Admin duyệt"}
          </h1>
          {official ? null : <StatusPills escrowPoints={survey.escrowPoints} />}
        </div>
      </div>

      <div data-tour="completion-code" className="flex flex-col gap-4 px-5 pt-5 lg:mt-6 lg:grid lg:grid-cols-2 lg:gap-0 lg:overflow-hidden lg:rounded-[28px] lg:border lg:border-line lg:bg-surface lg:p-0">
        <section
          aria-labelledby="code-title"
          className="rounded-[18px] border border-line bg-surface px-4.5 py-4 lg:rounded-none lg:border-0 lg:border-r lg:px-9 lg:py-8"
        >
          <h2 id="code-title" className="text-[16px] font-extrabold text-ink lg:text-[20px]">
            Mã hoàn thành của khảo sát
          </h2>
          <p className="mt-1 text-caption-relaxed text-ink-muted lg:text-body-sm">
            Người trả lời nhập mã này vào Rescom để nhận điểm.
          </p>
          <p className="mt-4 grid grid-cols-6 gap-1.5 lg:gap-2.5" aria-label={`Mã hoàn thành ${survey.completionCode.split("").join(" ")}`}>
            {survey.completionCode.split("").map((digit, index) => (
              <span
                key={index}
                aria-hidden="true"
                className="flex h-13 items-center justify-center rounded-field bg-surface-subtle text-[24px] font-extrabold text-ink lg:h-16 lg:rounded-control lg:text-[30px]"
              >
                {digit}
              </span>
            ))}
          </p>
          <button
            type="button"
            onClick={() => void copy()}
            className="mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-field border border-primary bg-surface text-[15px] font-bold text-primary transition-colors hover:bg-primary/5"
          >
            <Icon name={copyState === "copied" ? "check" : "copy"} size={18} />
            {copyState === "copied" ? "Đã chép dòng mã" : "Chép dòng mã"}
          </button>
          <p aria-live="polite" className="sr-only">
            {copyState === "copied" ? "Đã chép dòng mã vào bộ nhớ tạm." : ""}
          </p>
          {copyState === "failed" ? <p className="mt-2 text-caption text-danger">{CLIPBOARD_COPY_FAILED_MESSAGE}</p> : null}
          <p className="mt-3.5 flex items-start gap-2.5 rounded-field bg-tone-amber-bg px-3 py-3 text-caption-relaxed text-ink lg:mt-4.5 lg:rounded-control lg:px-3.5 lg:text-body-sm">
            <Icon name="lock" size={18} className="shrink-0 text-tone-amber-fg" />
            <span>
              <strong className="font-bold">Mã chỉ hiện một lần.</strong> Rescom không lưu mã dạng đọc được. Hãy dán vào
              form ngay bây giờ.
            </span>
          </p>
        </section>

        <section
          aria-labelledby="paste-title"
          className="rounded-[18px] border border-line bg-surface px-4.5 py-4 lg:rounded-none lg:border-0 lg:bg-surface-panel lg:px-9 lg:py-8"
        >
          <h2 id="paste-title" className="text-[16px] font-extrabold text-ink lg:text-[20px]">
            Dán mã vào cuối Google Form
          </h2>
          <ol className="mt-4 flex flex-col gap-3.5 text-body-sm text-ink lg:mt-5 lg:gap-4 lg:text-lead-sm">
            <PasteStep index={1}>
              Mở form → <strong className="font-bold">Cài đặt</strong> → <strong className="font-bold">Bản trình bày</strong>.
            </PasteStep>
            <PasteStep index={2}>
              Ở <strong className="font-bold">Tin nhắn xác nhận</strong>, dán dòng:
              <code className="mt-2 block w-fit rounded-[10px] bg-surface-subtle px-2.5 py-1.5 font-mono text-[13px] font-bold text-ink lg:px-3 lg:py-2 lg:text-[14px]">
                {line}
              </code>
            </PasteStep>
            <PasteStep index={3}>Lưu, rồi gửi thử form một lần để thấy mã hiện ở trang cảm ơn.</PasteStep>
          </ol>
          <a
            href={survey.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-body-sm font-bold text-primary hover:underline lg:mt-5 lg:text-[15px]"
          >
            <Icon name="external-link" size={16} />
            Mở Google Form
            <span className="sr-only"> (mở tab mới)</span>
          </a>
        </section>
      </div>

      <div className="flex flex-col gap-4 px-5 pt-4 pb-8 lg:mt-6 lg:flex-row lg:items-center lg:justify-between lg:p-0">
        <Checkbox
          id="code-pasted"
          size={20}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          label={<span className="font-semibold">Tôi đã dán mã và gửi thử form</span>}
        />
        {/* ASSUMED: "Xong" waits for the confirmation — the code is never shown again. */}
        <Button size="lg" className="px-7 max-lg:w-full" disabled={!confirmed} onClick={finish}>
          Xong · xem Khảo sát của tôi
        </Button>
      </div>
    </div>
  );
}

function PasteStep({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 lg:gap-3.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-extrabold text-primary-foreground lg:size-8 lg:text-[14px]">
        {index}
      </span>
      <div className="min-w-0 pt-0.5">{children}</div>
    </li>
  );
}

/** ASSUMED (design) (not drawn): the code was already shown, or this tab never received it. */
function CodeGoneView({ formId }: { formId: string }) {
  return (
    <div className="mx-auto flex w-full max-w-120 flex-1 flex-col items-center gap-4 px-5 pt-16 pb-10 text-center">
      <Mascot name="create" height={120} />
      <h1 className="text-[22px] leading-[28.6px] font-extrabold text-ink">Mã hoàn thành không còn hiển thị</h1>
      <p className="text-body-sm text-ink-muted">
        Rescom chỉ hiện mã hoàn thành một lần, ngay sau khi gửi khảo sát. Nếu bạn chưa kịp dán mã vào form, hãy tạo mã
        mới trong trang khảo sát sau khi Admin duyệt xong.
      </p>
      <div className="mt-2 flex w-full flex-col gap-3">
        <Link href={`/forms/${formId}`} className={buttonClassName({ size: "lg", fullWidth: true })}>
          Xem khảo sát
        </Link>
        <Link href={MY_SURVEYS_HREF} className={buttonClassName({ variant: "secondary", size: "xl", fullWidth: true })}>
          Khảo sát của tôi
        </Link>
      </div>
    </div>
  );
}
