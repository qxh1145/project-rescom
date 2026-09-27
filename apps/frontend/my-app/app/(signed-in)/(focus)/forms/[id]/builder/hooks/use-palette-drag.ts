"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { FormBlockType } from "@rescom/schemas";
import { liftGhost, settledRect, startAutoScroll, trackPointer, type Ghost, type Point } from "./drag-ghost";
import { findDropTarget, sameTarget, type DropTarget } from "./use-reorder-drag";

/**
 * Drag a question type from the toolbox onto the canvas (Figma 13 · 72:78).
 * Press and hold (or press and move) a toolbox item: a lifted copy of it
 * follows the pointer, the drop indicator shows the gap while it is over the
 * canvas column, and on release the new question is inserted there and the
 * copy glides into it. Released anywhere else, the copy flies back. A plain
 * click (or Enter) still adds the question at the end of the selected section.
 *
 * `onDrop` inserts the block and returns its id (null when nothing was added).
 */
export function usePaletteDrag(
  listRef: RefObject<HTMLElement | null>,
  onDrop: (type: FormBlockType, target: DropTarget) => string | null,
) {
  const [draggingType, setDraggingType] = useState<FormBlockType | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const onDropRef = useRef(onDrop);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onDropRef.current = onDrop;
  });
  useEffect(() => () => abortRef.current?.(), []);

  const onPointerDown = useCallback(
    (type: FormBlockType, event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || event.pointerType === "touch") return;
      const el = event.currentTarget;
      const start = { x: event.clientX, y: event.clientY };
      let ghost: Ghost | null = null;
      let pointer: Point = start;
      let overCanvas = false;
      let stopScroll = () => {};

      const update = () => {
        const list = listRef.current;
        // The canvas column (between the toolbox and the properties panel) accepts drops.
        const column = list?.closest("main")?.getBoundingClientRect();
        overCanvas = Boolean(list && column && pointer.x >= column.left && pointer.x <= column.right);
        ghost?.setOver(overCanvas);
        const next = overCanvas && list ? findDropTarget(list, pointer.y) : null;
        if (!sameTarget(next, targetRef.current)) {
          targetRef.current = next;
          setTarget(next);
        }
      };

      abortRef.current = trackPointer(event, {
        lift(point) {
          pointer = point;
          ghost = liftGhost(el, { dx: point.x - start.x, dy: point.y - start.y });
          setDraggingType(type);
          stopScroll = startAutoScroll(() => (overCanvas ? pointer.y : null), update);
          update();
        },
        move(point) {
          pointer = point;
          ghost?.moveTo(point.x - start.x, point.y - start.y);
          update();
        },
        end(commit) {
          abortRef.current = null;
          stopScroll();
          const dropTarget = targetRef.current;
          targetRef.current = null;
          setTarget(null);
          const created = commit && dropTarget ? onDropRef.current(type, dropTarget) : null;
          requestAnimationFrame(() => {
            const list = listRef.current;
            const card = created ? list?.querySelector<HTMLElement>(`[data-drop-card="${CSS.escape(created)}"]`) : null;
            const slot = document.querySelector<HTMLElement>(`[data-palette-slot="${CSS.escape(type)}"]`);
            const landing = card && list ? ghost?.land(settledRect(card, list), { fade: true }) : ghost?.land(slot?.getBoundingClientRect() ?? null);
            void landing?.then(() => setDraggingType((current) => (current === type ? null : current)));
          });
        },
      });
    },
    [listRef],
  );

  const itemProps = (type: FormBlockType) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(type, event),
  });

  return { draggingType, target, itemProps };
}
