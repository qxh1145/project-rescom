"use client";

import { forwardRef, type CSSProperties } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { Icon } from "@/components/ui/Icon";
import { buttonClassName } from "@/components/ui/Button";
import type { TourStep } from "@/lib/product-tour/tour-definitions";
import type { CoachPosition } from "@/lib/product-tour/tour-logic";

interface TourCoachmarkProps {
  tourTitle: string;
  step: TourStep;
  index: number;
  total: number;
  position: CoachPosition | null;
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
}

export const COACHMARK_WIDTH = 360;

/** Arrow nub (canvas 20 kit): 18px white square turned 45°, 8px outside the card. */
function arrowStyle(position: CoachPosition): CSSProperties | null {
  if (position.arrowOffset === null || position.placement === "floating") return null;
  const offset = position.arrowOffset - 9;
  switch (position.placement) {
    case "bottom":
      return { top: -8, left: offset };
    case "top":
      return { bottom: -8, left: offset };
    case "right":
      return { left: -8, top: offset };
    case "left":
      return { right: -8, top: offset };
  }
}

/**
 * Coachmark — canvas 20 "Thành phần tour": info (Tiếp), action (waits for the
 * real click, "Bỏ qua bước"), final (Xong). Positioned by `placeCoachmark`.
 */
export const TourCoachmark = forwardRef<HTMLDivElement, TourCoachmarkProps>(function TourCoachmark(
  { tourTitle, step, index, total, position, onNext, onBack, onStop },
  ref,
) {
  const titleId = "product-tour-title";
  const bodyId = "product-tour-body";
  const arrow = position ? arrowStyle(position) : null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="fixed z-[62] flex flex-col gap-3.5 rounded-[20px] bg-surface px-5 pt-4.5 pb-5 text-ink shadow-[0_22px_56px_rgba(8,12,32,0.38)]"
      style={{
        width: COACHMARK_WIDTH,
        left: position?.x ?? 0,
        top: position?.y ?? 0,
        visibility: position ? "visible" : "hidden",
      }}
    >
      {arrow ? <span aria-hidden className="absolute size-4.5 rotate-45 rounded-[3px] bg-surface" style={arrow} /> : null}

      <div className="flex items-center gap-2.5">
        {step.mascot && index === 0 ? <Mascot name={step.mascot} height={48} className="shrink-0" /> : null}
        <p className="text-[12px] leading-[1.35] font-bold tracking-[0.2px] text-primary-strong">
          {tourTitle} · Bước {index + 1}/{total}
        </p>
        <button
          type="button"
          onClick={onStop}
          aria-label="Dừng hướng dẫn"
          className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink hover:bg-line"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 id={titleId} tabIndex={-1} className="text-[19px] leading-[1.3] font-extrabold tracking-[-0.2px] text-pretty focus:outline-none">
          {step.title}
        </h2>
        <p id={bodyId} className="text-body-sm text-ink-strong text-pretty">
          {step.body}
        </p>
      </div>

      {step.points ? (
        <ol className="flex flex-col gap-2">
          {step.points.map((point, pointIndex) => (
            <li key={point} className="flex items-start gap-2.5 text-body-sm text-ink-strong">
              <span
                aria-hidden
                className="mt-px flex size-5.5 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-tone-amber-accent text-[12px] font-extrabold text-ink"
              >
                {pointIndex + 1}
              </span>
              <span>{point}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {step.kind === "action" && step.hint ? (
        <p className="flex items-start gap-2.5 rounded-field bg-tone-green-bg px-3 py-2.5 text-[13px] leading-normal font-semibold text-tone-green-fg">
          <Icon name="target" size={18} className="mt-px shrink-0" />
          <span>{step.hint}</span>
        </p>
      ) : null}

      <div className="flex items-center gap-2.5">
        <span aria-hidden className="flex gap-1">
          {Array.from({ length: total }, (_, dot) => (
            <span key={dot} className={`h-1.5 w-4 rounded-full ${dot <= index ? "bg-primary" : "bg-line"}`} />
          ))}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {index > 0 ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="Quay lại bước trước"
              className="flex size-11 items-center justify-center rounded-field border border-line-strong bg-surface text-ink hover:bg-surface-subtle"
            >
              <Icon name="chevron-left" size={18} />
            </button>
          ) : null}
          {step.kind === "action" ? (
            <button
              type="button"
              onClick={onNext}
              className="h-11 px-1.5 text-[13px] font-bold text-ink-muted underline underline-offset-3 hover:text-ink"
            >
              Bỏ qua bước
            </button>
          ) : (
            <button type="button" onClick={onNext} className={buttonClassName({ size: "md", radius: "field", className: "gap-2" })}>
              {step.kind === "final" ? "Xong" : "Tiếp"}
              <Icon name={step.kind === "final" ? "check" : "arrow-right"} size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
