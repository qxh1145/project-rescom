"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { useGoogleFormWizard } from "../hooks/use-google-form-wizard";
import { AudienceAside, AudienceStep } from "./AudienceStep";
import { InfoAside, InfoStep } from "./InfoStep";
import { RewardAside, RewardStep } from "./RewardStep";
import { ArrowLabel, WizardFrame } from "./WizardFrame";

const TITLES = {
  1: "Tạo khảo sát Google Forms",
  2: "Ai nên trả lời khảo sát này?",
  3: "Số mẫu & điểm thưởng",
} as const;

/** `/forms/new/google-form?step=1|2|3` — Figma 9a, 9b, 9c/9c'. */
export function GoogleFormWizard() {
  const wizard = useGoogleFormWizard();
  const { step, draft, update, errors, quote, insufficient } = wizard;

  const submitLabel = insufficient
    ? "Chưa đủ điểm để gửi"
    : quote
      ? `Khoá ${quote.cost} điểm & gửi duyệt`
      : "Khoá điểm & gửi duyệt";

  function primaryButton(fullWidth: boolean) {
    if (step < 3) {
      return (
        <Button
          size="lg"
          fullWidth={fullWidth}
          className={fullWidth ? "" : "px-7"}
          disabled={wizard.prefillLoading}
          onClick={wizard.next}
        >
          <ArrowLabel>{step === 1 ? "Tiếp tục: chọn đối tượng" : "Tiếp tục"}</ArrowLabel>
        </Button>
      );
    }
    return (
      <Button
        size="lg"
        fullWidth={fullWidth}
        className={fullWidth ? "px-2" : "px-7"}
        disabled={insufficient}
        loading={wizard.submitting}
        loadingLabel="Đang gửi…"
        onClick={() => void wizard.submit()}
      >
        {submitLabel}
      </Button>
    );
  }

  return (
    <WizardFrame
      step={step}
      onBack={wizard.back}
      title={TITLES[step]}
      subtitle={step === 2 ? "Chọn ít nhất 1 tiêu chí. Chỉ người có hồ sơ phù hợp mới thấy khảo sát của bạn." : undefined}
      aside={
        step === 1 ? (
          <InfoAside draft={draft} available={wizard.available} />
        ) : step === 2 ? (
          <AudienceAside draft={draft} estimate={wizard.estimate} />
        ) : (
          <RewardAside draft={draft} quote={quote} />
        )
      }
      desktopActions={
        <>
          {step === 1 ? (
            // Figma 9a "Link – Huỷ": leaves the wizard (the draft stays saved).
            <Link href="/forms" className={buttonClassName({ variant: "secondary", size: "xl", className: "px-6" })}>
              Huỷ
            </Link>
          ) : (
            <Button variant="secondary" size="xl" className="px-6" onClick={wizard.back}>
              Quay lại
            </Button>
          )}
          {primaryButton(false)}
        </>
      }
      mobileActions={
        step === 1 ? (
          primaryButton(true)
        ) : (
          <>
            <Button variant="secondary" size="xl" className="w-27.5 shrink-0" onClick={wizard.back}>
              Quay lại
            </Button>
            <div className="min-w-0 flex-1">{primaryButton(true)}</div>
          </>
        )
      }
    >
      {wizard.prefillNotice ? (
        <Alert tone={wizard.prefillNotice.tone} className="mb-6">
          {wizard.prefillNotice.message}
        </Alert>
      ) : null}
      {wizard.prefillLoading ? (
        <div role="status" className="flex items-center gap-3 py-10 text-body-sm text-ink-muted">
          <Spinner className="size-6 text-primary" />
          Đang điền sẵn thông tin khảo sát cũ…
        </div>
      ) : (
        <>
          {step === 1 ? <InfoStep draft={draft} errors={errors} update={update} /> : null}
          {step === 2 ? <AudienceStep draft={draft} errors={errors} update={update} estimate={wizard.estimate} /> : null}
          {step === 3 ? (
            <RewardStep draft={draft} errors={errors} update={update} quote={quote} insufficient={insufficient} />
          ) : null}
        </>
      )}
      {wizard.submitErrorMessage ? (
        <Alert tone="danger" className="mt-6">
          {wizard.submitErrorMessage}
        </Alert>
      ) : null}
    </WizardFrame>
  );
}
