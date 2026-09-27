"use client";

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/**
 * Drop targets are read from the DOM of the canvas: every question card has
 * `data-drop-card` (+ section id, index in section, 1-based question number)
 * and every empty section a `data-drop-empty` placeholder. The target is the
 * gap before the first item whose vertical middle is below the pointer.
 */
export interface DropTarget {
  sectionId: string | null;
  /** Gap index inside the section (or the form without sections). */
  index: number;
  /** 1-based question number the block gets there ("Thả vào đây · câu 3"). */
  number: number;
  /** Card the gap sits above; null = end of the section. */
  beforeBlockId: string | null;
}

export function findDropTarget(container: HTMLElement, clientY: number): DropTarget | null {
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-drop-card],[data-drop-empty]"));
  if (items.length === 0) return null;
  const read = (item: HTMLElement) => ({
    sectionId: item.dataset.section || null,
    index: Number(item.dataset.index ?? 0),
    number: Number(item.dataset.number ?? 1),
    blockId: item.dataset.dropCard ?? null,
  });
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      const info = read(item);
      return { sectionId: info.sectionId, index: info.index, number: info.number, beforeBlockId: info.blockId };
    }
  }
  const last = read(items[items.length - 1]);
  return last.blockId
    ? { sectionId: last.sectionId, index: last.index + 1, number: last.number + 1, beforeBlockId: null }
    : { sectionId: last.sectionId, index: 0, number: last.number, beforeBlockId: null };
}

const EDGE = 80;
const SCROLL_STEP = 14;

/**
 * Pointer-based reorder (mouse, pen and touch — the grip has
 * `touch-action: none`), used on desktop (13a) and in the mobile reorder mode
 * (13e). Keyboard users have the move up/down buttons instead.
 */
export function useReorderDrag(
  containerRef: RefObject<HTMLElement | null>,
  onDrop: (blockId: string, target: DropTarget) => void,
) {
  const [dragging, setDragging] = useState<{ blockId: string; offsetY: number } | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const start = useRef<{ blockId: string; startY: number; scrollY: number } | null>(null);

  const onPointerDown = useCallback((blockId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { blockId, startY: event.clientY, scrollY: window.scrollY };
    setDragging({ blockId, offsetY: 0 });
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = start.current;
      const container = containerRef.current;
      if (!current || !container) return;
      if (event.clientY < EDGE) window.scrollBy(0, -SCROLL_STEP);
      else if (event.clientY > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_STEP);
      setDragging({
        blockId: current.blockId,
        offsetY: event.clientY - current.startY + (window.scrollY - current.scrollY),
      });
      setTarget(findDropTarget(container, event.clientY));
    },
    [containerRef],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const current = start.current;
      start.current = null;
      if (commit && current && target) onDrop(current.blockId, target);
      setDragging(null);
      setTarget(null);
    },
    [onDrop, target],
  );

  const gripProps = (blockId: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(blockId, event),
    onPointerMove,
    onPointerUp: () => finish(true),
    onPointerCancel: () => finish(false),
    style: { touchAction: "none" as const },
  });

  return { dragging, target, gripProps };
}
