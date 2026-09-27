"use client";

import { useId, useState } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { Icon } from "@/components/ui/Icon";
import { thoughtSecondsLabel, thoughtStatusLabel, type ThoughtStatus, type ThoughtStep } from "@/lib/forms/ai-thinking";

interface ThoughtLineProps {
  steps: readonly ThoughtStep[];
  status: ThoughtStatus;
  /** Active step while running; the step it stopped on when stopped; `steps.length` when done. */
  activeIndex: number;
  seconds: number;
  slow?: boolean;
  /** Mobile keeps details only on the latest finished step and the active one. */
  compact?: boolean;
  /** Inside an answer that already shows the assistant's avatar: no mascot in the header. */
  bare?: boolean;
}

type StepState = "done" | "active" | "pending";

/**
 * "Trợ lý đang suy nghĩ" (canvas 13b₁ / 13b₂): a collapsible header
 * ("Đang suy nghĩ · 7 giây") over a vertical line of steps. Open while running,
 * collapses itself to "Đã suy nghĩ trong N giây" when the answer lands, and can
 * be reopened to see why the draft looks the way it does.
 */
export function ThoughtLine({ steps, status, activeIndex, seconds, slow = false, compact = false, bare = false }: ThoughtLineProps) {
  const id = useId();
  const [open, setOpen] = useState(status === "running");
  const [seenStatus, setSeenStatus] = useState(status);
  const running = status === "running";

  // Collapse when a run ends; reopen when a new one starts (state adjusted during render).
  if (seenStatus !== status) {
    setSeenStatus(status);
    setOpen(status === "running");
  }

  const current = steps[Math.min(activeIndex, steps.length - 1)];
  const stateOf = (index: number): StepState =>
    index < activeIndex ? "done" : index === activeIndex && running ? "active" : "pending";
  const liveText = running
    ? current
      ? `${current.activeTitle}…`
      : thoughtStatusLabel(status)
    : `${thoughtStatusLabel(status)} ${thoughtSecondsLabel(status, seconds)}`;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={`${id}-steps`}
        className="group inline-flex min-h-11 max-w-full items-center gap-2.5 self-start rounded-[12px] pr-2.5 text-left text-body-sm font-semibold text-ink-muted hover:text-ink"
      >
        {bare ? null : (
        <span
          className={`relative flex size-8 shrink-0 items-center justify-center rounded-full bg-tone-green-bg ${running ? "thought-ring" : ""}`}
          aria-hidden="true"
        >
          <span className="flex size-8 items-center justify-center overflow-hidden rounded-full">
            <Mascot name={running ? "think" : "wave"} height={38} />
          </span>
        </span>
        )}
        <span className={running ? "thought-shimmer font-bold" : "font-bold text-ink-strong"}>{thoughtStatusLabel(status)}</span>
        <span className="font-medium whitespace-nowrap">{thoughtSecondsLabel(status, seconds)}</span>
        {running && !open && current ? (
          <span className="hidden min-w-0 truncate font-medium text-ink-strong sm:inline">· {current.activeTitle}…</span>
        ) : null}
        <Icon name="chevron-right" size={16} className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </button>
      {running && !open && current ? (
        <span className={`${bare ? "" : "pl-10.5"} text-caption text-ink-strong sm:hidden`}>{current.activeTitle}…</span>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {liveText}
      </p>

      {open ? (
        <div id={`${id}-steps`} className="thought-box mt-1.5 rounded-control border border-line bg-surface px-3.5 py-3.5 sm:px-5 sm:py-4.5">
          <ol className="flex flex-col" aria-label="Các bước trợ lý đang làm">
            {steps.map((step, index) => {
              const state = stateOf(index);
              const latestDone = index === activeIndex - 1;
              const showDetail = state === "active" || (state === "done" && (!compact || latestDone || !running));
              return (
                <li key={step.id} className="thought-item relative flex gap-3 pb-3.5 last:pb-0 sm:pb-4" data-state={state}>
                  <span className="thought-node relative z-[1] flex size-6 shrink-0 items-center justify-center rounded-full" aria-hidden="true">
                    {state === "done" ? <Icon name="check-bold" size={13} /> : null}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span
                      className={`text-body-sm leading-6 ${
                        state === "active"
                          ? "thought-shimmer font-bold"
                          : state === "done"
                            ? "font-bold text-ink"
                            : "font-medium text-ink-muted"
                      }`}
                    >
                      {state === "active" ? `${step.activeTitle}…` : step.title}
                    </span>
                    <span className="sr-only">
                      {state === "done" ? "(đã xong)" : state === "active" ? "(đang làm)" : running ? "(chưa làm)" : "(chưa xong)"}
                    </span>
                    {showDetail && step.detail ? (
                      <span className="thought-fade text-body-sm leading-[22.4px] text-ink-strong">
                        {step.detail}
                        {state === "active" ? <span className="thought-caret" aria-hidden="true" /> : null}
                      </span>
                    ) : null}
                    {showDetail && step.chips && step.chips.length > 0 ? (
                      <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Dạng câu hỏi">
                        {step.chips.map((chip) => (
                          <li
                            key={chip}
                            className="thought-fade inline-flex h-7 items-center rounded-[8px] border border-line bg-surface-muted px-2.5 text-caption font-semibold text-ink-strong"
                          >
                            {chip}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {slow ? (
            <p className="thought-fade mt-3 flex items-start gap-2 rounded-[10px] bg-tone-amber-tint px-3 py-2 text-caption leading-[19.5px] text-tone-amber-fg">
              <Icon name="hourglass" size={16} className="mt-0.5" />
              Lâu hơn bình thường một chút. Bạn có thể chờ thêm, hoặc bấm Dừng và soạn tay.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
