"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * Shared pointer-drag engine for the builder: the toolbox palette
 * (use-palette-drag) and the card reorder (use-reorder-drag). A press lifts
 * after a small move or a short hold; a clone of the pressed element (the
 * "ghost") then follows the pointer until it lands.
 */

const THRESHOLD = 4;
const HOLD_MS = 220;
const EDGE = 96;
const MAX_SCROLL_SPEED = 18;
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const LIFTED = { rotate: "-2deg", scale: "1.03", boxShadow: "0 18px 32px rgba(30, 36, 70, 0.24)" };
const RESTING = { rotate: "0deg", scale: "1", boxShadow: "0 0 0 rgba(30, 36, 70, 0)" };

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface Point {
  x: number;
  y: number;
}

export interface Ghost {
  /** Moves the clone by (dx, dy) from where the pressed element was. */
  moveTo: (dx: number, dy: number) => void;
  setOver: (over: boolean) => void;
  /** Glides onto `to` (fading out with `fade`), then removes the clone. */
  land: (to: { left: number; top: number } | null, options?: { fade?: boolean }) => Promise<void>;
}

export function liftGhost(source: HTMLElement, at: { dx: number; dy: number }): Ghost {
  const rect = source.getBoundingClientRect();
  const el = source.cloneNode(true) as HTMLElement;
  el.removeAttribute("id");
  el.removeAttribute("data-drop-card");
  el.removeAttribute("data-palette-slot");
  el.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
  el.setAttribute("aria-hidden", "true");
  el.inert = true;
  Object.assign(el.style, {
    position: "fixed",
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    zIndex: "60",
    pointerEvents: "none",
    translate: `${at.dx}px ${at.dy}px`,
    willChange: "translate",
    transition: "border-color 150ms, background-color 150ms",
  });
  document.body.appendChild(el);
  if (reducedMotion()) Object.assign(el.style, LIFTED);
  else el.animate([RESTING, LIFTED], { duration: 180, easing: EASE, fill: "forwards" });

  let current = at;
  return {
    moveTo(dx, dy) {
      current = { dx, dy };
      el.style.translate = `${dx}px ${dy}px`;
    },
    setOver(over) {
      el.style.borderColor = over ? "var(--color-primary)" : "";
    },
    land(to, { fade = false } = {}) {
      return new Promise((resolve) => {
        const done = () => {
          el.remove();
          resolve();
        };
        if (!to || reducedMotion()) return done();
        el.getAnimations().forEach((animation) => animation.cancel());
        const animation = el.animate(
          [
            { translate: `${current.dx}px ${current.dy}px`, opacity: 1, ...LIFTED },
            { translate: `${to.left - rect.left}px ${to.top - rect.top}px`, opacity: fade ? 0 : 1, ...RESTING },
          ],
          { duration: 220, easing: EASE, fill: "forwards" },
        );
        animation.onfinish = done;
        animation.oncancel = done;
      });
    },
  };
}

/** Scrolls the page while the pointer is near the top / bottom edge, faster the closer it is. */
export function startAutoScroll(getY: () => number | null, onScroll: () => void) {
  let raf = 0;
  const tick = () => {
    const y = getY();
    const depth = y === null ? 0 : y < EDGE ? y - EDGE : y > window.innerHeight - EDGE ? y - window.innerHeight + EDGE : 0;
    if (depth !== 0) {
      window.scrollBy(0, Math.sign(depth) * Math.ceil((Math.min(Math.abs(depth), EDGE) / EDGE) * MAX_SCROLL_SPEED));
      onScroll();
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Finishes layout (FLIP) animations on `el` and its ancestors up to `root`, so its rect is the final slot. */
export function settledRect(el: HTMLElement, root: HTMLElement) {
  for (let node: HTMLElement | null = el; node && node !== root; node = node.parentElement) {
    node.getAnimations().forEach((animation) => animation.finish());
  }
  return el.getBoundingClientRect();
}

interface DragHandlers {
  /** The press became a drag (moved past the threshold or was held). */
  lift: (point: Point) => void;
  move: (point: Point) => void;
  /** Drag over: `commit` is false for Esc, pointer cancel or unmount. */
  end: (commit: boolean) => void;
}

let active: (() => void) | null = null;

/**
 * Follows one press on window listeners. Returns an abort function (or null
 * when another drag is already running). A press that never lifts is left
 * alone, so it stays a normal click.
 */
export function trackPointer(event: ReactPointerEvent<HTMLElement>, handlers: DragHandlers): (() => void) | null {
  if (active) return null;
  const pointerId = event.pointerId;
  const start = { x: event.clientX, y: event.clientY };
  let last = start;
  let lifted = false;
  let moved = false;

  const lift = () => {
    lifted = true;
    document.documentElement.classList.add("reorder-dragging");
    window.getSelection()?.removeAllRanges();
    handlers.lift(last);
  };
  const hold = window.setTimeout(() => {
    if (!lifted) lift();
  }, HOLD_MS);

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    last = { x: e.clientX, y: e.clientY };
    if (!moved && Math.hypot(last.x - start.x, last.y - start.y) >= THRESHOLD) moved = true;
    if (!lifted) {
      if (!moved) return;
      lift();
    }
    e.preventDefault();
    handlers.move(last);
  };
  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    teardown();
    if (!lifted) return;
    // A real drag must not also click (select a card / add a block at the end).
    if (moved) swallowNextClick();
    handlers.end(true);
  };
  const cancel = (e: PointerEvent) => e.pointerId === pointerId && abort();
  const key = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !lifted) return;
    e.preventDefault();
    abort();
  };

  const teardown = () => {
    window.clearTimeout(hold);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key);
    document.documentElement.classList.remove("reorder-dragging");
    if (active === abort) active = null;
  };
  const abort = () => {
    if (active !== abort) return;
    teardown();
    if (lifted) handlers.end(false);
  };

  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key);
  active = abort;
  return abort;
}

function swallowNextClick() {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
}
