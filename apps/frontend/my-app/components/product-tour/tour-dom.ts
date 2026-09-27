"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Rect } from "@/lib/product-tour/tour-logic";

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
  const [element, setElement] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!name) return;
    const check = () => {
      const found = findTourTarget(name);
      setElement((current) => (current === found ? current : found));
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    const timer = window.setInterval(check, 500);
    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      setElement(null);
    };
  }, [name]);

  return name ? element : null;
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

/** Viewport size, updated on resize. */
export function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
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
