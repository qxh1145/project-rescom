"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { SPOTLIGHT_PADDING, type Rect } from "@/lib/product-tour/tour-logic";

/** Tours are desktop-only for now (canvas section 20); mobile gets a bottom-sheet version later. */
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(callback: () => void): () => void {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

/** First visible `[data-tour="<name>"]` (the same target may exist once per breakpoint). */
export function findTourTarget(name: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(name)}"]`);
  for (const node of nodes) {
    const box = node.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return node;
  }
  return null;
}

/**
 * Waits for a tour target to appear (it may mount later: a wizard step, data
 * still loading) and returns it; `null` while absent. Re-checks on DOM changes
 * and on a slow timer, so a target that disappears is noticed too.
 */
export function useTourTarget(name: string | null): HTMLElement | null {
  // Tagged with the name it was found for, so the next step never gets the previous target.
  const [found, setFound] = useState<{ name: string; element: HTMLElement | null } | null>(null);

  useEffect(() => {
    if (!name) return;
    const check = () => {
      const element = findTourTarget(name);
      setFound((current) => (current?.name === name && current.element === element ? current : { name, element }));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    const timer = window.setInterval(check, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
    };
  }, [name]);

  return name && found?.name === name ? found.element : null;
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Live viewport rect of `element` (follows scroll, resize, sticky headers, layout shifts). */
export function useLiveRect(element: HTMLElement | null): Rect | null {
  // Tagged with the element it was measured on, so a stale rect is never returned.
  const [measured, setMeasured] = useState<{ element: HTMLElement; rect: Rect } | null>(null);

  useEffect(() => {
    if (!element) return;
    let frame = 0;
    const tick = () => {
      // A target removed by a route change measures 0×0 until `useTourTarget` notices: keep the last rect.
      if (!element.isConnected) {
        frame = window.requestAnimationFrame(tick);
        return;
      }
      const box = element.getBoundingClientRect();
      const next = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
      setMeasured((current) => (current?.element === element && sameRect(current.rect, next) ? current : { element, rect: next }));
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [element]);

  return element && measured?.element === element ? measured.rect : null;
}

/** Viewport size, updated on resize. Client-only: the tour never renders on the server. */
export function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState(() =>
    typeof window === "undefined" ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight },
  );
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Glide of the spotlight to a new target, and its close when the target goes away. */
const SPOTLIGHT_MOVE_MS = 420;
/** A target missing for less than this (re-render, next step mounting) changes nothing on screen. */
const SPOTLIGHT_LOSS_GRACE_MS = 150;
/** How long the dim layer stays up, hole closed, waiting for the next target (route change + data load). */
const SPOTLIGHT_HOLD_MS = 4000;
/** Fade-out once the hold runs out (the tour then waits hidden). */
export const SPOTLIGHT_FADE_MS = 250;

export interface Spotlight {
  /** Target-space rect of the hole (`spotlightRect` adds the padding); may be negative-sized while closed. */
  rect: Rect;
  /** No target on screen: the hole closes, the page is dimmed but not blocked. */
  holding: boolean;
  /** Gliding to a new target. */
  moving: boolean;
  /** The hold ran out: the dim layer fades away. */
  fading: boolean;
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A hole of zero size (after padding) at the centre of `rect`. */
function closedAt(rect: Rect): Rect {
  return {
    x: rect.x + rect.width / 2 + SPOTLIGHT_PADDING,
    y: rect.y + rect.height / 2 + SPOTLIGHT_PADDING,
    width: -2 * SPOTLIGHT_PADDING,
    height: -2 * SPOTLIGHT_PADDING,
  };
}

function sameSpotlight(a: Spotlight | null, b: Spotlight | null): boolean {
  if (!a || !b) return a === b;
  return a.holding === b.holding && a.moving === b.moving && a.fading === b.fading && sameRect(a.rect, b.rect);
}

/**
 * What the dim layer shows for `target`, so it never blinks between steps:
 * - follows the target exactly (scroll, layout shifts);
 * - glides from the previous hole when `stepKey` changes;
 * - when the target goes away (next step on another route, still loading),
 *   keeps the page dimmed and closes the hole, then opens it on the next
 *   target; after `SPOTLIGHT_HOLD_MS` without one it fades out → `null`.
 */
export function useSpotlight(target: Rect | null, stepKey: string): Spotlight | null {
  const latest = useRef({ target, stepKey });
  useLayoutEffect(() => {
    latest.current = { target, stepKey };
  });
  const [spotlight, setSpotlight] = useState<Spotlight | null>(null);

  useEffect(() => {
    const moveMs = prefersReducedMotion() ? 0 : SPOTLIGHT_MOVE_MS;
    let frame = 0;
    let shown: Rect | null = null;
    let key = latest.current.stepKey;
    let retarget = false;
    let mode: "track" | "hold" = "track";
    let glide: { from: Rect; start: number } | null = null;
    let lostAt: number | null = null;
    let last: Spotlight | null = null;

    const tick = (now: number) => {
      const current = latest.current;
      if (current.stepKey !== key) {
        key = current.stepKey;
        retarget = true;
      }

      let desired: Rect | null = null;
      let holding = false;
      let fading = false;
      if (current.target) {
        if (shown && moveMs > 0 && (retarget || mode === "hold")) glide = { from: shown, start: now };
        mode = "track";
        retarget = false;
        lostAt = null;
        desired = current.target;
      } else if (shown) {
        lostAt ??= now;
        const lost = now - lostAt;
        if (lost < SPOTLIGHT_LOSS_GRACE_MS && mode === "track") {
          glide = null;
          desired = shown;
        } else if (lost < SPOTLIGHT_HOLD_MS + SPOTLIGHT_FADE_MS) {
          if (mode === "track") {
            mode = "hold";
            glide = moveMs > 0 ? { from: shown, start: now } : null;
            desired = closedAt(shown);
          } else {
            desired = glide ? closedAt(glide.from) : shown;
          }
          holding = true;
          fading = lost >= SPOTLIGHT_HOLD_MS;
        } else {
          mode = "track";
          glide = null;
        }
      }

      if (!desired) {
        shown = null;
      } else if (glide) {
        const progress = Math.min(1, (now - glide.start) / moveMs);
        const t = easeInOutCubic(progress);
        const from = glide.from;
        shown = {
          x: lerp(from.x, desired.x, t),
          y: lerp(from.y, desired.y, t),
          width: lerp(from.width, desired.width, t),
          height: lerp(from.height, desired.height, t),
        };
        if (progress >= 1) glide = null;
      } else {
        shown = desired;
      }

      const next = shown ? { rect: shown, holding, moving: glide !== null && !holding, fading } : null;
      if (!sameSpotlight(last, next)) {
        last = next;
        setSpotlight(next);
      }
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return spotlight;
}
