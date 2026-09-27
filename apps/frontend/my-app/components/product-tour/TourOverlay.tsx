"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TourDefinition } from "@/lib/product-tour/tour-definitions";
import { placeCoachmark, spotlightRect, SPOTLIGHT_RADIUS, type CoachPosition, type Rect } from "@/lib/product-tour/tour-logic";
import { COACHMARK_WIDTH, TourCoachmark } from "./TourCoachmark";
import { prefersReducedMotion, useLiveRect, useTourTarget, useViewport } from "./tour-dom";

interface TourOverlayProps {
  tour: TourDefinition;
  index: number;
  /** false while the current route is not the step's route: the tour waits, hidden. */
  onRoute: boolean;
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
}

/** How long an optional step waits for its target before it is skipped. */
const OPTIONAL_WAIT_MS = 1500;

/**
 * Spotlight layer (canvas 20): dims the page at #0E1226 · 72%, cuts a rounded
 * hole 8px around the target with a 3px #FADC7A ring, and places the
 * coachmark beside it. Info steps block the page; action steps let clicks
 * through the hole only, and the click on the target moves the tour on.
 */
export function TourOverlay({ tour, index, onRoute, onNext, onBack, onStop }: TourOverlayProps) {
  const step = tour.steps[index];
  const element = useTourTarget(onRoute ? step.target : null);
  const target = useLiveRect(element);
  const viewport = useViewport();
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<{ width: number; height: number } | null>(null);
  const hasTarget = target !== null;

  // Optional steps (activation banner, 48-hour list) skip themselves when absent.
  useEffect(() => {
    if (!onRoute || !step.optional || element) return;
    const timer = window.setTimeout(onNext, OPTIONAL_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [onRoute, step.optional, element, onNext]);

  // Bring the target into view once per step.
  useEffect(() => {
    element?.scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [element]);

  // Action steps advance on the real click (after the app handled it).
  useEffect(() => {
    if (!element || step.kind !== "action") return;
    const onClick = () => window.setTimeout(onNext, 0);
    element.addEventListener("click", onClick);
    return () => element.removeEventListener("click", onClick);
  }, [element, step.kind, onNext]);

  // Measure the coachmark to place it.
  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const measure = () => {
      const box = node.getBoundingClientRect();
      setCard((current) =>
        current && current.width === box.width && current.height === box.height ? current : { width: box.width, height: box.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasTarget, index]);

  // Focus the step title so screen readers announce it; keyboard shortcuts.
  useEffect(() => {
    if (!hasTarget) return;
    cardRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [index, hasTarget]);

  useEffect(() => {
    if (!target) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onStop();
      } else if (event.key === "ArrowRight" && step.kind !== "action" && isFromCoachmark(event, cardRef.current)) {
        onNext();
      } else if (event.key === "ArrowLeft" && index > 0 && isFromCoachmark(event, cardRef.current)) {
        onBack();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, step.kind, index, onNext, onBack, onStop]);

  if (!target || viewport.width === 0) return null;

  const hole = spotlightRect(target);
  const position: CoachPosition | null = card
    ? placeCoachmark(target, { width: COACHMARK_WIDTH, height: card.height }, viewport, step.placement)
    : null;

  return createPortal(
    <div data-product-tour="" className="contents">
      <svg aria-hidden className="pointer-events-none fixed inset-0 z-[60]" width={viewport.width} height={viewport.height}>
        <defs>
          <mask id="product-tour-mask">
            <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="#fff" />
            <rect x={hole.x} y={hole.y} width={hole.width} height={hole.height} rx={SPOTLIGHT_RADIUS} fill="#000" />
          </mask>
        </defs>
        <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="#0e1226" fillOpacity={0.72} mask="url(#product-tour-mask)" />
        <rect x={hole.x} y={hole.y} width={hole.width} height={hole.height} rx={SPOTLIGHT_RADIUS} fill="none" stroke="#fadc7a" strokeWidth={3} />
      </svg>

      <Blockers hole={hole} viewport={viewport} passThrough={step.kind === "action"} />

      {step.kind === "action" ? (
        <span aria-hidden className="tour-beacon z-[61]" style={{ left: hole.x + hole.width - 13, top: hole.y - 5 }} />
      ) : null}

      <TourCoachmark
        ref={cardRef}
        tourTitle={tour.title}
        step={step}
        index={index}
        total={tour.steps.length}
        position={position}
        onNext={onNext}
        onBack={onBack}
        onStop={onStop}
      />
    </div>,
    document.body,
  );
}

function isFromCoachmark(event: KeyboardEvent, card: HTMLElement | null): boolean {
  return card !== null && event.target instanceof Node && card.contains(event.target);
}

/** Transparent click-catchers: everything for info steps, all but the hole for action steps. */
function Blockers({ hole, viewport, passThrough }: { hole: Rect; viewport: { width: number; height: number }; passThrough: boolean }) {
  const base = "fixed z-[60]";
  if (!passThrough) return <div aria-hidden className={`${base} inset-0`} />;
  const right = hole.x + hole.width;
  const bottom = hole.y + hole.height;
  return (
    <>
      <div aria-hidden className={base} style={{ left: 0, top: 0, width: viewport.width, height: Math.max(0, hole.y) }} />
      <div aria-hidden className={base} style={{ left: 0, top: bottom, width: viewport.width, height: Math.max(0, viewport.height - bottom) }} />
      <div aria-hidden className={base} style={{ left: 0, top: hole.y, width: Math.max(0, hole.x), height: hole.height }} />
      <div aria-hidden className={base} style={{ left: right, top: hole.y, width: Math.max(0, viewport.width - right), height: hole.height }} />
    </>
  );
}
