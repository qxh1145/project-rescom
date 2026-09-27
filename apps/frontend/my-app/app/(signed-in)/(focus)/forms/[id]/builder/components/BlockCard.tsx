"use client";

import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { FormBlock } from "@rescom/schemas";
import { isAttentionCheck } from "@/lib/forms/builder-blocks";
import { gripProps, type DragState } from "../hooks/use-reorder-drag";
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
  /** Set while this card is being dragged (it stays behind as a placeholder). */
  dragPhase: DragState["phase"] | null;
  dragProps: { onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void };
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
 * Alt+↑ / Alt+↓ on the focused card moves it. A mouse drags the card from
 * anywhere (grab cursor); touch and pen drag from the grip.
 */
export function BlockCard(props: BlockCardProps) {
  const { block, number, selected, pendingAttention, isAi, issues, readOnly, dragPhase } = props;
  const titleId = `card-${block.id}-title`;

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
      {...(readOnly ? {} : props.dragProps)}
      onClick={props.onSelect}
      className={`group/card relative rounded-[16px] ${border} ${selected ? "p-[15px]" : "p-4"} pl-10 transition-[border-color,box-shadow] duration-150 ${
        readOnly ? "" : "cursor-grab select-none hover:shadow-[0_4px_14px_rgba(30,36,70,0.08)]"
      } ${dragPhase === "drag" ? "opacity-40" : dragPhase === "settle" ? "opacity-0" : ""}`}
    >
      {!readOnly ? (
        <span
          {...gripProps}
          aria-hidden="true"
          className="absolute top-7 left-3 flex size-5 items-center justify-center opacity-60 transition-opacity group-hover/card:opacity-100"
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
        className="mt-2 block w-full cursor-[inherit] rounded-[6px] text-left text-lead leading-[22.4px] font-bold text-ink"
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
        <div
          data-no-drag=""
          className="mt-4 flex cursor-default items-center justify-between border-t border-line-subtle pt-3"
          onClick={(e) => e.stopPropagation()}
        >
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
