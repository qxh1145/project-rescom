"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TourDefinition } from "@/lib/product-tour/tour-definitions";
import { placeCoachmark, spotlightRect, SPOTLIGHT_RADIUS, type CoachPosition, type Rect } from "@/lib/product-tour/tour-logic";
import { COACHMARK_WIDTH, TourCoachmark } from "./TourCoachmark";
import { prefersReducedMotion, SPOTLIGHT_FADE_MS, useLiveRect, useSpotlight, useTourTarget, useViewport } from "./tour-dom";

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
 *
 * Mounted once per tour, not per step (`TourProvider` keys it by tour): the
 * hole glides between targets and the dim layer stays up across route
 * changes (`useSpotlight`), so nothing blinks between steps.
 */
export function TourOverlay({ tour, index, onRoute, onNext, onBack, onStop }: TourOverlayProps) {
  const step = tour.steps[index];
  const element = useTourTarget(onRoute ? step.target : null);
  const target = useLiveRect(element);
  const spotlight = useSpotlight(target, String(index));
  const viewport = useViewport();
  const cardRef = useRef<HTMLDivElement>(null);
  const [card, setCard] = useState<{ width: number; height: number } | null>(null);
  const hasTarget = target !== null;
  // The layer renders a frame after the target is found (the spotlight runs on rAF).
  const shown = spotlight !== null;

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
  }, [shown, index]);

  // Focus the step title so screen readers announce it; keyboard shortcuts.
  useEffect(() => {
    if (!hasTarget || !shown) return;
    cardRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [index, hasTarget, shown]);

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

  if (!spotlight || viewport.width === 0) return null;

  const hole = spotlightRect(spotlight.rect);
  const holeWidth = Math.max(0, hole.width);
  const holeHeight = Math.max(0, hole.height);
  const liveHole = target && !spotlight.holding ? spotlightRect(target) : null;
  // Placed by the drawn hole, so the card glides with it; the side is the one it ends on next to
  // the target. While the target is away the card keeps its last place (faded out).
  const cardSize = card ? { width: COACHMARK_WIDTH, height: card.height } : null;
  const side = cardSize && target ? placeCoachmark(target, cardSize, viewport, step.placement).placement : null;
  const position: CoachPosition | null =
    cardSize && target && !spotlight.holding
      ? placeCoachmark(spotlight.rect, cardSize, viewport, side === "floating" || !side ? step.placement : side)
      : null;

  return createPortal(
    <div data-product-tour="" className="contents">
      <svg
        aria-hidden
        className="tour-fade-in pointer-events-none fixed inset-0 z-[60]"
        width={viewport.width}
        height={viewport.height}
        style={{ opacity: spotlight.fading ? 0 : 1, transition: `opacity ${SPOTLIGHT_FADE_MS}ms ease` }}
      >
        <defs>
          <mask id="product-tour-mask">
            <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="#fff" />
            <rect x={hole.x} y={hole.y} width={holeWidth} height={holeHeight} rx={SPOTLIGHT_RADIUS} fill="#000" />
          </mask>
        </defs>
        <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="#0e1226" fillOpacity={0.72} mask="url(#product-tour-mask)" />
        <rect
          x={hole.x}
          y={hole.y}
          width={holeWidth}
          height={holeHeight}
          rx={SPOTLIGHT_RADIUS}
          fill="none"
          stroke="#fadc7a"
          strokeWidth={3}
          style={{ opacity: spotlight.holding ? 0 : 1, transition: "opacity 200ms ease" }}
        />
      </svg>

      {/* Only around a target on screen: a closed hole waiting for the next page never traps it. */}
      {liveHole ? <Blockers hole={liveHole} viewport={viewport} passThrough={step.kind === "action"} /> : null}

      {step.kind === "action" && liveHole && !spotlight.moving ? (
        <span aria-hidden className="tour-beacon z-[61]" style={{ left: hole.x + hole.width - 13, top: hole.y - 5 }} />
      ) : null}

      <TourCoachmark
        ref={cardRef}
        tourTitle={tour.title}
        step={step}
        index={index}
        total={tour.steps.length}
        position={position}
        hidden={spotlight.holding}
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
