"use client";

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { FormBlock } from "@rescom/schemas";
import { isAttentionCheck } from "@/lib/forms/builder-blocks";
import { BlockPreview } from "./BlockPreview";
import { AiChip, AttentionChip, GripIcon, Toggle, ToolButton, TypeChip } from "./BuilderBits";

export interface BlockCardProps {
  block: FormBlock;
  number: number;
  sectionId: string | null;
  indexInSection: number;
  selected: boolean;
  pendingAttention: boolean;
  isAi: boolean;
  issues: readonly string[];
  readOnly: boolean;
  /** Vertical drag offset while this card is being dragged. */
  dragOffset: number | null;
  gripProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    style: { touchAction: "none" };
  };
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onRequiredChange: (required: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
}

/**
 * Canvas question card (Figma 13a 72:269; pending AI check 63:948): grip,
 * number, type / attention / AI chips, title with a red asterisk, answer
 * preview; the selected card shows "Bắt buộc", move, duplicate and delete.
 * Alt+↑ / Alt+↓ on the focused card moves it.
 */
export function BlockCard(props: BlockCardProps) {
  const { block, number, selected, pendingAttention, isAi, issues, readOnly, dragOffset } = props;
  const titleId = `card-${block.id}-title`;
  const dragging = dragOffset !== null;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (readOnly || !event.altKey) return;
    if (event.key === "ArrowUp" && props.canMoveUp) {
      event.preventDefault();
      props.onMove(-1);
    } else if (event.key === "ArrowDown" && props.canMoveDown) {
      event.preventDefault();
      props.onMove(1);
    }
  };

  const border = pendingAttention
    ? "border border-dashed border-tone-amber-strong bg-tone-amber-tint"
    : selected
      ? "border-2 border-primary bg-surface"
      : issues.length > 0
        ? "border border-danger bg-surface"
        : "border border-line bg-surface";

  return (
    <article
      aria-labelledby={titleId}
      data-drop-card={block.id}
      data-section={props.sectionId ?? ""}
      data-index={props.indexInSection}
      data-number={number}
      onClick={props.onSelect}
      className={`relative rounded-[16px] ${border} ${selected ? "p-[15px]" : "p-4"} pl-10 ${
        dragging ? "z-20 rotate-[-1.5deg] shadow-[0_14px_14px_rgba(30,36,70,0.22)]" : ""
      }`}
      style={dragging ? { transform: `translateY(${dragOffset}px) rotate(-1.5deg)` } : undefined}
    >
      {!readOnly ? (
        <span
          {...props.gripProps}
          aria-hidden="true"
          className="absolute top-7 left-3 flex size-5 cursor-grab items-center justify-center active:cursor-grabbing"
        >
          <GripIcon />
        </span>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption font-extrabold text-ink-muted">{number}</span>
        <TypeChip type={block.type} />
        {pendingAttention ? <AttentionChip pending /> : isAttentionCheck(block) ? <AttentionChip /> : null}
        {isAi ? <AiChip /> : null}
      </div>

      <button
        type="button"
        id={titleId}
        onKeyDown={onKeyDown}
        onClick={(event) => {
          event.stopPropagation();
          props.onSelect();
        }}
        aria-pressed={selected}
        aria-describedby={issues.length > 0 ? `card-${block.id}-issues` : undefined}
        className="mt-2 block w-full rounded-[6px] text-left text-lead leading-[22.4px] font-bold text-ink"
      >
        <span className="sr-only">Câu {number}: </span>
        {block.title}
        {block.required ? (
          <>
            {" "}
            <span aria-hidden="true" className="font-extrabold text-danger">
              *
            </span>
            <span className="sr-only">(bắt buộc)</span>
          </>
        ) : null}
      </button>
      {block.description ? <p className="mt-1 text-body-sm text-ink-muted">{block.description}</p> : null}

      {!pendingAttention || selected ? (
        <div className="mt-3.5">
          <BlockPreview block={block} />
        </div>
      ) : null}

      {issues.length > 0 ? (
        <ul id={`card-${block.id}-issues`} className="mt-3 text-caption text-danger">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      {selected && !readOnly ? (
        <div className="mt-4 flex items-center justify-between border-t border-line-subtle pt-3" onClick={(e) => e.stopPropagation()}>
          <Toggle
            id={`card-${block.id}-required`}
            checked={block.required}
            onChange={props.onRequiredChange}
            label="Bắt buộc"
            size="sm"
          />
          <div className="flex items-center gap-1">
            <ToolButton icon="chevron-down" rotate label={`Chuyển câu ${number} lên`} disabled={!props.canMoveUp} onClick={() => props.onMove(-1)} />
            <ToolButton icon="chevron-down" label={`Chuyển câu ${number} xuống`} disabled={!props.canMoveDown} onClick={() => props.onMove(1)} />
            <ToolButton icon="copy" label={`Nhân bản câu ${number}`} onClick={props.onDuplicate} />
            <ToolButton icon="trash" danger label={`Xoá câu ${number}`} onClick={props.onDelete} />
          </div>
        </div>
      ) : null}
    </article>
  );
}
