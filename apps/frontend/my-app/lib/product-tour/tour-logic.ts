import type { ProductTourId, ProductTourProgressDto } from "@rescom/schemas";
import type { TourDefinition, TourPlacement } from "./tour-definitions.ts";

/**
 * Rules of the interactive product tours (canvas section 20). Pure: no React,
 * no DOM, so `tests/product-tour.test.mjs` covers them directly.
 */

/**
 * The step to show for `pathname`: the current one while its route matches,
 * otherwise the first LATER step whose route matches (the user moved ahead in
 * the flow, e.g. took a survey inside Rescom and skipped the Google Forms
 * steps), otherwise the current one — the tour then waits, hidden, until the
 * user reaches a matching screen.
 */
export function resolveStepForPath(tour: TourDefinition, current: number, pathname: string): number {
  const from = Math.max(0, Math.min(current, tour.steps.length - 1));
  for (let index = from; index < tour.steps.length; index += 1) {
    if (tour.steps[index].route.test(pathname)) return index;
  }
  return from;
}

export type TourHubState = "todo" | "doing" | "done";

export interface TourHubView {
  state: TourHubState;
  /** Zero-based step to resume from ("doing" only). */
  step: number;
}

/** Hub row for one tour. A DISMISSED tour that never got past step 1 reads as not started. */
export function tourHubView(progress: readonly ProductTourProgressDto[], tourId: ProductTourId): TourHubView {
  const row = progress.find((item) => item.tourId === tourId);
  if (!row) return { state: "todo", step: 0 };
  if (row.status === "COMPLETED") return { state: "done", step: 0 };
  if (row.step === 0 && row.status === "DISMISSED") return { state: "todo", step: 0 };
  return { state: "doing", step: row.step };
}

export function completedCount(progress: readonly ProductTourProgressDto[]): number {
  return progress.filter((item) => item.status === "COMPLETED").length;
}

/** Whether the user has seen or answered an offer for this tour (any stored row). */
export function hasTouched(progress: readonly ProductTourProgressDto[], tourId: ProductTourId): boolean {
  return progress.some((item) => item.tourId === tourId);
}

/**
 * Canvas 20.1: the welcome invite shows once, on Khám phá, to an account that
 * has never touched any tour.
 */
export function shouldShowWelcome(progress: readonly ProductTourProgressDto[], pathname: string): boolean {
  return progress.length === 0 && /^\/marketplace\/?$/.test(pathname);
}

/** Canvas 20.2: "Đăng khảo sát" stays locked until there are points to spend. */
export function isTourLocked(tourId: ProductTourId, availablePoints: number | null): boolean {
  return tourId === "FIRST_PUBLISH" && (availablePoints ?? 0) <= 0;
}

/** The first IN_PROGRESS tour, for the "Tiếp tục" nudge after a new sign-in. */
export function resumableTour(progress: readonly ProductTourProgressDto[]): ProductTourProgressDto | null {
  return progress.find((item) => item.status === "IN_PROGRESS") ?? null;
}

// ---------------------------------------------------------------- geometry

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CoachPosition {
  /** "floating": no side fits (target larger than the screen) — pinned bottom-right, no arrow. */
  placement: TourPlacement | "floating";
  x: number;
  y: number;
  /** Arrow distance from the card's left (top/bottom) or top (left/right) edge; null without arrow. */
  arrowOffset: number | null;
}

/** Spotlight padding around the target and its corner radius (canvas 20: 8px, 16px). */
export const SPOTLIGHT_PADDING = 8;
export const SPOTLIGHT_RADIUS = 16;
/** Space between spotlight and card, and the minimum distance to the screen edge. */
const GAP = 18;
const EDGE = 16;
/** Keep the arrow away from the card's rounded corners. */
const ARROW_INSET = 28;

export function spotlightRect(target: Rect): Rect {
  return {
    x: target.x - SPOTLIGHT_PADDING,
    y: target.y - SPOTLIGHT_PADDING,
    width: target.width + SPOTLIGHT_PADDING * 2,
    height: target.height + SPOTLIGHT_PADDING * 2,
  };
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

function fallbackOrder(preferred: TourPlacement): TourPlacement[] {
  const order: TourPlacement[] = ["bottom", "right", "left", "top"];
  return [preferred, ...order.filter((item) => item !== preferred)];
}

function fits(side: TourPlacement, hole: Rect, card: Size, viewport: Size): boolean {
  switch (side) {
    case "bottom":
      return hole.y + hole.height + GAP + card.height <= viewport.height - EDGE;
    case "top":
      return hole.y - GAP - card.height >= EDGE;
    case "right":
      return hole.x + hole.width + GAP + card.width <= viewport.width - EDGE;
    case "left":
      return hole.x - GAP - card.width >= EDGE;
  }
}

/**
 * Where the coachmark goes: the preferred side when it fits, then bottom →
 * right → left → top (canvas 20 kit), clamped inside the viewport, with the
 * arrow pointing at the middle of the target.
 */
export function placeCoachmark(target: Rect, card: Size, viewport: Size, preferred: TourPlacement): CoachPosition {
  const hole = spotlightRect(target);
  const side = fallbackOrder(preferred).find((item) => fits(item, hole, card, viewport));

  if (!side) {
    return {
      placement: "floating",
      x: Math.max(EDGE, viewport.width - card.width - EDGE * 2),
      y: Math.max(EDGE, viewport.height - card.height - EDGE * 2),
      arrowOffset: null,
    };
  }

  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;

  if (side === "bottom" || side === "top") {
    const x = clamp(centerX - card.width / 2, EDGE, viewport.width - card.width - EDGE);
    const y = side === "bottom" ? hole.y + hole.height + GAP : hole.y - GAP - card.height;
    return { placement: side, x, y, arrowOffset: clamp(centerX - x, ARROW_INSET, card.width - ARROW_INSET) };
  }

  const x = side === "right" ? hole.x + hole.width + GAP : hole.x - GAP - card.width;
  const y = clamp(centerY - card.height / 2, EDGE, viewport.height - card.height - EDGE);
  return { placement: side, x, y, arrowOffset: clamp(centerY - y, ARROW_INSET, card.height - ARROW_INSET) };
}
