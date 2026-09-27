"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { Textarea } from "@/components/ui/Textarea";
import { DECISION_NOTE_MAX, type DisputeCase, type DisputeCaseOutcome } from "@/lib/admin/disputes-service";
import {
  actionsOf,
  caseSubtitle,
  caseTitle,
  descriptionHeading,
  timelineOf,
  urgencyLabel,
} from "@/lib/admin/disputes-view";
import { useCaseDecision } from "../hooks/use-case-decision";
import { ConfirmDecisionDialog } from "./ConfirmDecisionDialog";

interface CaseDetailProps {
  item: DisputeCase;
  now: number;
  onResolved: (resolved: DisputeCase, outcome: DisputeCaseOutcome) => void;
  onStale: (message: string) => void;
}

/**
 * Main card of Figma 11c (62:1668, 627px): case header, description,
 * evidence, attempt timeline, decision note and the two decision buttons.
 * Missing-code and locked-attempt cases reuse the anatomy (ASSUMED).
 */
export function CaseDetail({ item, now, onResolved, onStale }: CaseDetailProps) {
  const decision = useCaseDecision(item, { onResolved, onStale });
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const titleId = `case-title-${item.id}`;
  const noteId = `case-note-${item.id}`;

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 rounded-[22px] border border-line bg-surface px-5 pt-6.5 pb-7 lg:px-6.5"
    >
      <Tag tone="danger" className="text-danger-strong">
        {urgencyLabel(item, now)}
      </Tag>
      <h2 id={titleId} className="mt-1.5 text-title-sm font-extrabold text-ink">
        {caseTitle(item)}
      </h2>
      <p className="mt-2 text-[14px] text-ink-muted">{caseSubtitle(item)}</p>

      {item.description ? (
        <>
          <h3 className="mt-5 text-[14px] font-bold text-ink">{descriptionHeading(item)}</h3>
          <p className="mt-2 rounded-field bg-surface-muted px-3.5 py-3 text-body leading-6 text-ink">
            {item.description}
          </p>
        </>
      ) : null}

      {item.kind !== "LOCKED_ATTEMPT" ? (
        <>
          <h3 className="mt-4.5 text-[14px] font-bold text-ink">
            {item.evidence.length > 0 ? `Bằng chứng · ${item.evidence.length} ảnh` : "Bằng chứng"}
          </h3>
          {item.evidence.length > 0 ? (
            <ul className="mt-2.5 flex flex-wrap gap-3">
              {item.evidence.map((evidence, index) => {
                const label = `[Ảnh bằng chứng ${index + 1}]`;
                const tile =
                  "flex h-30.5 w-45.5 items-center justify-center rounded-field border border-dashed border-line-strong bg-surface-subtle text-caption text-ink-muted";
                return (
                  <li key={evidence.id}>
                    {evidence.url ? (
                      <a
                        href={evidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Xem ảnh bằng chứng ${index + 1} (mở tab mới)`}
                        className={`${tile} hover:border-ink-muted`}
                      >
                        {label}
                      </a>
                    ) : (
                      <span className={tile}>{label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 text-[14px] text-ink-muted">Không có ảnh đính kèm.</p>
          )}
        </>
      ) : null}

      <h3 className="mt-4.5 text-[14px] font-bold text-ink">Dòng thời gian lượt làm</h3>
      <ol className="mt-2 flex flex-col gap-2 text-[14px]">
        {timelineOf(item).map((row, index) => (
          <li key={`${row.at}-${index}`} className="grid grid-cols-[84px_minmax(0,1fr)]">
            <time dateTime={row.at} className="text-ink-muted">
              {row.time}
            </time>
            <span className="text-ink">
              {row.segments.map((segment, part) =>
                segment.strong ? (
                  <strong key={part} className="font-bold">
                    {segment.text}
                  </strong>
                ) : (
                  <span key={part}>{segment.text}</span>
                ),
              )}
            </span>
          </li>
        ))}
      </ol>

      <Textarea
        ref={noteRef}
        id={noteId}
        className="mt-4.5"
        label="Lý do quyết định · gửi email cho cả hai bên"
        placeholder="Ví dụ: Câu trả lời không hợp lệ: chọn một đáp án cho mọi câu và thời gian làm dưới một nửa thời gian khai."
        rows={2}
        maxLength={DECISION_NOTE_MAX}
        value={decision.note}
        onChange={(event) => decision.setNote(event.target.value)}
        error={decision.noteError ?? undefined}
        disabled={decision.busy}
      />

      <div className="mt-4.5 flex flex-wrap justify-end gap-3">
        {actionsOf(item).map((action) => (
          <Button
            key={action.outcome}
            variant={action.primary ? "primary" : "secondary"}
            size="lg"
            className={action.primary ? "px-9" : "min-w-45.5"}
            disabled={decision.busy}
            onClick={() => {
              if (!decision.request(action)) noteRef.current?.focus();
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>

      <ConfirmDecisionDialog
        action={decision.pending}
        note={decision.note.trim()}
        busy={decision.busy}
        error={decision.error}
        onCancel={decision.cancel}
        onConfirm={() => void decision.confirm()}
      />
    </section>
  );
}
