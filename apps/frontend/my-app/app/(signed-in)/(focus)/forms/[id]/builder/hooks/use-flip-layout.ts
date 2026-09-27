"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

const EASE = "cubic-bezier(0.2, 0, 0, 1)";

function currentTranslateY(el: HTMLElement) {
  const value = getComputedStyle(el).translate;
  if (!value || value === "none") return 0;
  return Number.parseFloat(value.split(" ")[1] ?? "0") || 0;
}

/**
 * FLIP layout animation for the builder lists: every `[data-flip="<key>"]`
 * element inside the container slides from where it was on the previous render
 * to its new place (reorder, insert, delete, collapse, a card growing), and a
 * key seen for the first time fades in. Positions are container-relative, so
 * scrolling never animates.
 */
export function useFlipLayout(containerRef: RefObject<HTMLElement | null>) {
  const previous = useRef(new Map<string, number>());
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const origin = container.getBoundingClientRect().top;
    const next = new Map<string, number>();
    const firstPass = !mounted.current;
    mounted.current = true;

    for (const el of container.querySelectorAll<HTMLElement>("[data-flip]")) {
      const key = el.dataset.flip as string;
      const shown = currentTranslateY(el);
      const top = el.getBoundingClientRect().top - origin - shown;
      next.set(key, top);
      if (!animate) continue;
      const before = previous.current.get(key);
      if (before === undefined) {
        if (!firstPass) {
          el.animate([{ opacity: 0, scale: "0.97" }, { opacity: 1, scale: "1" }], { duration: 200, easing: EASE });
        }
      } else if (Math.abs(before - top) > 0.5) {
        const from = before + shown - top;
        el.getAnimations().forEach((animation) => animation.cancel());
        el.animate([{ translate: `0 ${from}px` }, { translate: "0 0" }], { duration: 240, easing: EASE });
      }
    }
    previous.current = next;
  });
}
