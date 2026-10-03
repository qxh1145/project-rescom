"use client";

import { useState } from "react";
import type { NumberBlock, TextBlock, TextareaBlock } from "@rescom/schemas";
import { Textarea } from "@/components/ui/Textarea";
import { fieldClassName } from "@/components/ui/TextField";

/** Free-text answers (not drawn in Figma 4 — ASSUMED (design): page 8 input/textarea styles). */

interface BaseProps {
  inputId: string;
  labelledBy: string;
  describedBy?: string;
  invalid: boolean;
  onBlur?: () => void;
}

export function ShortTextAnswer({
  block,
  value,
  onChange,
  inputId,
  labelledBy,
  describedBy,
  invalid,
  onBlur,
}: BaseProps & { block: TextBlock; value: unknown; onChange: (value: string) => void }) {
  return (
    <input
      id={inputId}
      type="text"
      value={typeof value === "string" ? value : ""}
      maxLength={block.maxLength}
      placeholder={block.placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={block.required || undefined}
      className={fieldClassName(invalid, "h-12")}
    />
  );
}

export function LongTextAnswer({
  block,
  value,
  onChange,
  inputId,
  labelledBy,
  describedBy,
  invalid,
  onBlur,
}: BaseProps & { block: TextareaBlock; value: unknown; onChange: (value: string) => void }) {
  return (
    <Textarea
      id={inputId}
      value={typeof value === "string" ? value : ""}
      maxLength={block.maxLength}
      placeholder={block.placeholder}
      rows={4}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={block.required || undefined}
    />
  );
}

/** Parses "6,5" / "6.5"; keeps unparseable text so validation can explain it. */
export function parseNumberInput(raw: string): number | string | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : text;
}

export function NumberAnswer({
  block,
  value,
  onChange,
  inputId,
  labelledBy,
  describedBy,
  invalid,
  onBlur,
}: BaseProps & { block: NumberBlock; value: unknown; onChange: (value: number | string | undefined) => void }) {
  // The raw text survives intermediate input such as "6," while typing.
  const [text, setText] = useState(() =>
    typeof value === "number" ? String(value) : typeof value === "string" ? value : "",
  );
  return (
    <input
      id={inputId}
      type="text"
      inputMode={block.integerOnly ? "numeric" : "decimal"}
      value={text}
      placeholder={block.placeholder}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseNumberInput(event.target.value));
      }}
      onBlur={onBlur}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={block.required || undefined}
      className={fieldClassName(invalid, "h-12 lg:max-w-[329px]")}
    />
  );
}

export function DateAnswer({
  value,
  onChange,
  inputId,
  labelledBy,
  describedBy,
  invalid,
  required,
}: BaseProps & { value: unknown; onChange: (value: string) => void; required: boolean }) {
  return (
    <input
      id={inputId}
      type="date"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      className={fieldClassName(invalid, "h-12 lg:max-w-[329px]")}
    />
  );
}
