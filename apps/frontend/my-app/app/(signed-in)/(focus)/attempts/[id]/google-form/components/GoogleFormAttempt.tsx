"use client";

import { useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { EXTERNAL_MESSAGES } from "@/lib/participation/external-messages";
import { useGoogleFormAttempt } from "../hooks/use-google-form-attempt";
import { AttemptEndedScreen, type AttemptEndedVariant } from "./AttemptEndedScreen";
import { CancelAttemptDialog } from "./CancelAttemptDialog";
import { CodeEntryScreen } from "./CodeEntryScreen";
import { GoogleFormHeader } from "./GoogleFormHeader";
import { ReportMissingCodeDialog } from "./ReportMissingCodeDialog";

function minutesLabel(seconds: number): string {
  return `${Math.max(1, Math.round(seconds / 60))} phút`;
}

/** Figma page 5 "Google Forms + mã hoàn thành": 62:2 · 62:359 · 62:784 · 62:67. */
export function GoogleFormAttempt({ attemptId }: { attemptId: string }) {
  const state = useGoogleFormAttempt(attemptId);
  const [reportOpen, setReportOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { attempt, screen, query } = state;

  if (!attempt || !screen || screen.kind === "redirect") {
    if (query.error && !attempt) {
      const notFound = query.error.status === 404 || query.error.status === 403;
      return (
        <main className="mx-auto flex w-full max-w-[440px] flex-1 flex-col justify-center gap-4 px-5 py-10">
          <Alert tone="danger">{notFound ? EXTERNAL_MESSAGES.notFound : EXTERNAL_MESSAGES.loadFailed}</Alert>
          {notFound ? (
            <Link href="/marketplace" className={buttonClassName({ size: "lg", fullWidth: true })}>
              Làm khảo sát khác
            </Link>
          ) : (
            <Button size="lg" fullWidth onClick={query.reload}>
              Thử lại
            </Button>
          )}
        </main>
      );
    }
    return (
      <main className="flex flex-1 items-center justify-center" aria-busy="true">
        <Spinner className="size-8 text-primary" />
        <span className="sr-only">Đang tải lượt làm khảo sát…</span>
      </main>
    );
  }

  const subtitle = `Google Forms · ${minutesLabel(attempt.survey.estimatedEffortSeconds)}`;
  const inForm = screen.kind === "form";
  const ended: AttemptEndedVariant | null =
    screen.kind === "locked"
      ? "reason" in screen && screen.reason === "account-limit"
        ? "account-limit"
        : "locked"
      : screen.kind === "closed"
        ? screen.reason
        : null;

  return (
    <>
      <GoogleFormHeader
        title={attempt.survey.title}
        subtitle={subtitle}
        reward={inForm ? attempt.survey.rewardPerResponse : undefined}
        onCancel={inForm ? () => setCancelOpen(true) : undefined}
      />
      {inForm ? (
        <CodeEntryScreen attempt={attempt} state={state} onReport={() => setReportOpen(true)} />
      ) : ended ? (
        <AttemptEndedScreen variant={ended} onReport={ended === "cancelled" ? undefined : () => setReportOpen(true)} />
      ) : null}
      <ReportMissingCodeDialog attemptId={attemptId} open={reportOpen} onClose={() => setReportOpen(false)} />
      {inForm ? (
        <CancelAttemptDialog
          attemptId={attemptId}
          open={cancelOpen}
          onClose={() => setCancelOpen(false)}
          onCancelled={state.cancelled}
        />
      ) : null}
    </>
  );
}
