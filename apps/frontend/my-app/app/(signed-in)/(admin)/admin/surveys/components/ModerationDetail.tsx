"use client";

import { useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { Tag } from "@/components/ui/Tag";
import { formatShortDateTime } from "@/lib/format/date-time";
import {
  APPROVAL_BLOCKER_MESSAGES,
  MODERATION_LOAD_SURVEY_FAILED,
  moderationErrorMessage,
} from "@/lib/admin/moderation-messages";
import type { ModerationPreview } from "@/lib/admin/moderation-service";
import {
  approvalBlocker,
  checklistFor,
  effortBandLabel,
  formatDeadline,
  publisherLabel,
  surveySourceLabel,
  targetingSummary,
} from "@/lib/admin/moderation-view";
import type { useSurveyModeration } from "../hooks/use-survey-moderation";
import { RejectSurveyDialog } from "./RejectSurveyDialog";
import { topicLabel } from "@/lib/forms/topics";

type Moderation = ReturnType<typeof useSurveyModeration>;

const CARD = "rounded-[22px] border border-line bg-surface";

/** Figma 11a "Section – Chi tiết khảo sát" (62:3471). */
export function ModerationDetail({ moderation }: { moderation: Moderation }) {
  const { survey, loading, error, reload } = moderation.detail;

  if (!survey) {
    if (error) {
      return (
        <Alert tone="danger">
          <span>{moderationErrorMessage(error, MODERATION_LOAD_SURVEY_FAILED)}</span>{" "}
          <button type="button" onClick={reload} className="font-bold underline">
            Thử lại
          </button>
        </Alert>
      );
    }
    return (
      <div className={`${CARD} flex items-center gap-3 p-7 text-body-sm text-ink-muted`} role="status">
        <Spinner />
        {loading ? "Đang tải chi tiết khảo sát…" : null}
      </div>
    );
  }

  return <SurveyDetailCard key={survey.formId} survey={survey} moderation={moderation} />;
}

function SurveyDetailCard({ survey, moderation }: { survey: ModerationPreview; moderation: Moderation }) {
  const items = checklistFor(survey.type);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const queued = survey.status === "MODERATION_QUEUE";
  const blocker = approvalBlocker(survey, items.every((item) => checked[item.id]));
  const blockerMessage = blocker ? APPROVAL_BLOCKER_MESSAGES[blocker] : null;
  const escrow = survey.escrowHeld ?? survey.escrowAmount;

  return (
    <section aria-labelledby="moderation-title" className={`${CARD} p-5 lg:p-7`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-2">
            <Tag tone={survey.type === "EXTERNAL" ? "blue" : "green"}>{surveySourceLabel(survey.type)}</Tag>
            <StatusTag survey={survey} />
            {survey.isResubmission ? <Tag tone="amber">Bản chỉnh sửa v{survey.versionNumber}</Tag> : null}
          </div>
          <h2 id="moderation-title" className="mt-2 max-w-115 text-[24px] font-extrabold text-ink">
            {survey.title}
          </h2>
          <p className="mt-3.5 text-body-sm text-ink-muted">
            Người đăng: <strong className="font-bold text-ink">{publisherLabel(survey)}</strong>
            {survey.publisherEmail ? ` · ${survey.publisherEmail}` : null}
            {typeof survey.publisherFraudLogCount === "number"
              ? ` · ${survey.publisherFraudLogCount} vi phạm FraudLog`
              : null}
            {survey.type === "INTERNAL" && survey.blocksCount > 0 ? ` · ${survey.blocksCount} câu hỏi` : null}
          </p>
        </div>
        {survey.externalUrl ? (
          <a
            href={survey.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName({
              variant: "secondary",
              size: "md",
              radius: "field",
              className: "shrink-0 self-start",
            })}
          >
            <Icon name="external-link" size={16} />
            <span>Mở form để kiểm tra</span>
            <span className="sr-only"> (mở tab mới)</span>
          </a>
        ) : null}
      </div>

      {survey.description ? (
        <p className="mt-4 text-body text-ink [line-height:24px]">{survey.description}</p>
      ) : null}

      <dl className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Fact label="Thời gian khai">{effortBandLabel(survey.estimatedEffortSeconds)}</Fact>
        <Fact label="Số mẫu × điểm">
          {survey.expectedCompletions} × {survey.effectiveRewardPerResponse}
        </Fact>
        <Fact label={queued ? "Ký quỹ đã khoá" : "Ký quỹ"} tone="amber">
          {escrow} điểm
        </Fact>
        <Fact label="Hạn">{formatDeadline(survey.deadlineAt)}</Fact>
      </dl>
      {topicLabel(survey.topic) ? (
        <p className="mt-3 text-body-sm text-ink-strong">
          <span className="font-bold text-ink">Chủ đề:</span> {topicLabel(survey.topic)}
        </p>
      ) : null}

      <h3 className="mt-5 text-label font-bold text-ink">Đối tượng</h3>
      <p className={`mt-1.5 text-body-sm ${survey.targetingInvalid ? "text-danger" : "text-ink-strong"}`}>
        {targetingSummary(survey.targetingJson, survey.targetingInvalid)}
      </p>

      {queued ? (
        <>
          <fieldset className="mt-4.5 rounded-2xl border border-line px-4.25 pt-1 pb-4">
            <legend className="px-1.5 text-label font-bold text-ink">Kiểm tra trước khi duyệt</legend>
            <div className="mt-2 flex flex-col gap-2.5">
              {items.map((item) => (
                <Checkbox
                  key={item.id}
                  id={`check-${item.id}`}
                  size={20}
                  label={<span className="text-body-sm">{item.label}</span>}
                  checked={Boolean(checked[item.id])}
                  onChange={(event) => setChecked((current) => ({ ...current, [item.id]: event.target.checked }))}
                />
              ))}
            </div>
          </fieldset>

          {moderation.actionError ? (
            <Alert tone="danger" onDismiss={moderation.clearActionError} className="mt-5">
              {moderation.actionError}
            </Alert>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
            {blockerMessage ? (
              <p id="approve-blocker" className="text-caption text-ink-muted sm:mr-auto">
                {blockerMessage}
              </p>
            ) : null}
            <Button
              variant="danger-outline"
              size="xl"
              onClick={() => setRejectOpen(true)}
              disabled={moderation.approving}
            >
              Từ chối…
            </Button>
            <Button
              size="lg"
              leadingIcon={<Icon name="check" size={18} />}
              onClick={() => void moderation.approve(survey)}
              disabled={blocker !== null}
              aria-describedby={blockerMessage ? "approve-blocker" : undefined}
              loading={moderation.approving}
              loadingLabel="Đang duyệt…"
            >
              Duyệt &amp; đưa lên Khám phá
            </Button>
          </div>

          <RejectSurveyDialog
            open={rejectOpen}
            survey={survey}
            onClose={() => setRejectOpen(false)}
            onReject={async (reason) => {
              await moderation.reject(survey, reason);
              setRejectOpen(false);
            }}
          />
        </>
      ) : (
        <DecisionSummary survey={survey} />
      )}
    </section>
  );
}

function StatusTag({ survey }: { survey: ModerationPreview }) {
  if (survey.status === "MODERATION_QUEUE") {
    return <Tag>Chờ duyệt</Tag>;
  }
  if (survey.decision?.outcome === "APPROVED") return <Tag tone="green">Đã duyệt</Tag>;
  if (survey.decision?.outcome === "REJECTED") return <Tag tone="danger">Bị từ chối</Tag>;
  return <Tag>Không còn chờ duyệt</Tag>;
}

/** ASSUMED (not drawn): a survey opened by link after it was decided. */
function DecisionSummary({ survey }: { survey: ModerationPreview }) {
  const { decision } = survey;
  let text = "Khảo sát này không còn trong hàng chờ duyệt.";
  if (decision?.outcome === "APPROVED") {
    text = `Đã duyệt lúc ${formatShortDateTime(decision.decidedAt)}.`;
  } else if (decision?.outcome === "REJECTED") {
    const refund = decision.refundAmount > 0 ? ` Đã hoàn ${decision.refundAmount} điểm ký quỹ.` : "";
    text = `Đã từ chối lúc ${formatShortDateTime(decision.decidedAt)}. Lý do: ${decision.reason ?? "—"}.${refund}`;
  }
  return (
    <Alert tone="info" className="mt-5">
      {text}
    </Alert>
  );
}

function Fact({ label, tone, children }: { label: string; tone?: "amber"; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[14px] bg-surface-muted px-3.5 py-2.75">
      <dt className="text-[12px] font-semibold text-ink-muted">{label}</dt>
      <dd className={`text-[16px] font-extrabold ${tone === "amber" ? "text-tone-amber-fg" : "text-ink"}`}>
        {children}
      </dd>
    </div>
  );
}
