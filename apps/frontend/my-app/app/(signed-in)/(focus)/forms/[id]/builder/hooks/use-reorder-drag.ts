"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { liftGhost, settledRect, startAutoScroll, trackPointer, type Ghost } from "./drag-ghost";

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
  /** Middle of the gap in px from the container top (where the indicator is drawn). */
  y: number;
}

export function findDropTarget(container: HTMLElement, clientY: number, halfGap = 6): DropTarget | null {
  const items = Array.from(container.querySelectorAll<HTMLElement>("[data-drop-card],[data-drop-empty]"));
  if (items.length === 0) return null;
  const top = container.getBoundingClientRect().top;
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
      const y = info.blockId ? rect.top - top - halfGap : rect.top - top + rect.height / 2;
      return { sectionId: info.sectionId, index: info.index, number: info.number, beforeBlockId: info.blockId, y };
    }
  }
  const lastItem = items[items.length - 1];
  const rect = lastItem.getBoundingClientRect();
  const last = read(lastItem);
  return last.blockId
    ? { sectionId: last.sectionId, index: last.index + 1, number: last.number + 1, beforeBlockId: null, y: rect.bottom - top + halfGap }
    : { sectionId: last.sectionId, index: 0, number: last.number, beforeBlockId: null, y: rect.top - top + rect.height / 2 };
}

export function sameTarget(a: DropTarget | null, b: DropTarget | null) {
  return a === b || (a !== null && b !== null && a.sectionId === b.sectionId && a.index === b.index && a.number === b.number && a.y === b.y);
}

/** Put on the grip icon: the only place a touch / pen drag may start (it keeps page scrolling elsewhere). */
export const gripProps = { "data-drag-grip": "", style: { touchAction: "none" as const } };

/** Mouse presses on these never start a drag. */
const NO_DRAG = "input,textarea,select,[contenteditable],[role='switch'],[data-no-drag]";

export interface DragState {
  blockId: string;
  /** `drag`: the card is a dimmed placeholder; `settle`: the ghost is flying into place. */
  phase: "drag" | "settle";
}

/**
 * Pointer-based reorder, used on the desktop canvas (13a) and the mobile list
 * (13e). A mouse drags a card from anywhere on it (after a small move or a
 * short hold, so clicks still select); touch and pen start from the grip. The
 * card stays as a dimmed placeholder while a lifted clone follows the pointer,
 * the page scrolls near the viewport edges, and on drop the clone glides into
 * the new slot. Esc cancels. Keyboard users have the move up/down buttons.
 */
export function useReorderDrag(
  containerRef: RefObject<HTMLElement | null>,
  onDrop: (blockId: string, target: DropTarget) => void,
  { halfGap = 6 }: { halfGap?: number } = {},
) {
  const [dragging, setDragging] = useState<DragState | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const onDropRef = useRef(onDrop);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onDropRef.current = onDrop;
  });
  // Unmounted mid-drag (route change): drop the clone and the global cursor.
  useEffect(() => () => abortRef.current?.(), []);

  const onPointerDown = useCallback(
    (blockId: string, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const pressed = event.target as Element;
      const fromGrip = pressed.closest("[data-drag-grip]") !== null;
      const allowed = fromGrip || (event.pointerType === "mouse" && pressed.closest(NO_DRAG) === null);
      if (!allowed) return;
      const el = event.currentTarget;
      const startY = event.clientY;
      const origin = {
        sectionId: el.dataset.section || null,
        index: Number(el.dataset.index ?? 0),
        number: Number(el.dataset.number ?? 1),
      };
      let ghost: Ghost | null = null;
      let pointerY = startY;
      let stopScroll = () => {};

      const update = () => {
        const container = containerRef.current;
        if (!container) return;
        let next = findDropTarget(container, pointerY, halfGap);
        // Dropping right above or below itself changes nothing: hide the indicator.
        if (next && next.sectionId === origin.sectionId && (next.index === origin.index || next.index === origin.index + 1)) {
          next = null;
        }
        // Numbers after the dragged card shift up once it leaves its slot.
        if (next && next.number > origin.number) next = { ...next, number: next.number - 1 };
        if (!sameTarget(next, targetRef.current)) {
          targetRef.current = next;
          setTarget(next);
        }
      };

      abortRef.current = trackPointer(event, {
        lift(point) {
          pointerY = point.y;
          ghost = liftGhost(el, { dx: 0, dy: point.y - startY });
          setDragging({ blockId, phase: "drag" });
          stopScroll = startAutoScroll(() => pointerY, update);
          update();
        },
        move(point) {
          pointerY = point.y;
          ghost?.moveTo(0, point.y - startY);
          update();
        },
        end(commit) {
          abortRef.current = null;
          stopScroll();
          const dropTarget = targetRef.current;
          targetRef.current = null;
          setTarget(null);
          setDragging({ blockId, phase: "settle" });
          if (commit && dropTarget) onDropRef.current(blockId, dropTarget);
          // Next frame: React has moved the card; the clone glides onto its (new or original) slot.
          requestAnimationFrame(() => {
            const container = containerRef.current;
            const card = container?.querySelector<HTMLElement>(`[data-drop-card="${CSS.escape(blockId)}"]`);
            void ghost
              ?.land(card && container ? settledRect(card, container) : null)
              .then(() => setDragging((state) => (state?.blockId === blockId && state.phase === "settle" ? null : state)));
          });
        },
      });
    },
    [containerRef, halfGap],
  );

  const dragProps = (blockId: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(blockId, event),
  });

  return { dragging, target, dragProps };
}
