"use client";

import type { FormBlock } from "@rescom/schemas";
import { StarRating } from "@/components/ui/StarRating";
import { MultipleChoiceAnswer, SingleChoiceAnswer } from "./answers/ChoiceAnswer";
import { ScaleAnswer, scaleValues } from "./answers/ScaleAnswer";
import { DateAnswer, LongTextAnswer, NumberAnswer, ShortTextAnswer } from "./answers/TextAnswers";
import { FileUploadAnswer, PreviewFileAnswer } from "./answers/FileUploadAnswer";
import type { FileUploadControls } from "../hooks/use-file-uploads";

interface QuestionCardProps {
  block: FormBlock;
  number: number;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  /** Free-text fields report "done typing" (telemetry) on blur. */
  onBlur?: () => void;
  /** Upload state of a `file_upload` question (the runner's); absent in the builder preview. */
  upload?: FileUploadControls;
}

/**
 * Figma 4 question card (62:168 / 62:743): white, #E1E6EF border, 20px
 * radius / 24px padding on desktop, 18px / 18px on mobile; "3. Title *" in
 * bold 18px (16px mobile) with a red asterisk for required questions.
 */
export function QuestionCard({ block, number, value, error, onChange, onBlur, upload }: QuestionCardProps) {
  const titleId = `q-${block.id}-title`;
  const errorId = error ? `q-${block.id}-error` : undefined;
  const descriptionId = block.description ? `q-${block.id}-description` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  const inputId = `q-${block.id}-input`;
  const common = { labelledBy: titleId, describedBy };

  return (
    <section
      id={`q-${block.id}`}
      aria-labelledby={titleId}
      className={`scroll-mt-40 rounded-[18px] border bg-surface p-[18px] lg:scroll-mt-24 lg:rounded-[20px] lg:p-6 ${
        error ? "border-danger" : "border-line"
      }`}
    >
      {/* tabIndex -1: focus lands here when a new page of questions opens. */}
      <h2
        id={titleId}
        tabIndex={-1}
        className="text-lead font-bold leading-[23.2px] text-ink focus:outline-none lg:text-body-lg lg:leading-normal"
      >
        {number}. {block.title}
        {block.required ? (
          <>
            {" "}
            <span className="text-danger" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(bắt buộc)</span>
          </>
        ) : null}
      </h2>
      {block.description ? (
        <p id={descriptionId} className="mt-1 text-body-sm text-ink-muted">
          {block.description}
        </p>
      ) : null}

      <div className="mt-4 lg:mt-5">
        {block.type === "single_choice" ? (
          <SingleChoiceAnswer block={block} value={value} onChange={onChange} {...common} />
        ) : block.type === "multiple_choice" ? (
          <MultipleChoiceAnswer block={block} value={value} onChange={onChange} {...common} />
        ) : block.type === "linear_scale" ? (
          <ScaleAnswer
            name={block.id}
            values={scaleValues(block.min, block.max, block.step)}
            value={value}
            onChange={onChange}
            minLabel={block.minLabel}
            maxLabel={block.maxLabel}
            required={block.required}
            {...common}
          />
        ) : block.type === "rating" && block.ratingShape === "NUMBER" ? (
          <ScaleAnswer
            name={block.id}
            values={scaleValues(1, block.maxRating)}
            value={value}
            onChange={onChange}
            required={block.required}
            {...common}
          />
        ) : block.type === "rating" ? (
          <StarRating
            value={typeof value === "number" ? value : null}
            onChange={onChange}
            size={40}
            gap={12}
            legend={`${number}. ${block.title}`}
            labels={ratingLabels(block.maxRating)}
          />
        ) : block.type === "text" ? (
          <ShortTextAnswer block={block} value={value} onChange={onChange} inputId={inputId} invalid={Boolean(error)} onBlur={onBlur} {...common} />
        ) : block.type === "textarea" ? (
          <LongTextAnswer block={block} value={value} onChange={onChange} inputId={inputId} invalid={Boolean(error)} onBlur={onBlur} {...common} />
        ) : block.type === "number" ? (
          <NumberAnswer block={block} value={value} onChange={onChange} inputId={inputId} invalid={Boolean(error)} onBlur={onBlur} {...common} />
        ) : block.type === "date" ? (
          <DateAnswer
            value={value}
            onChange={onChange}
            inputId={inputId}
            invalid={Boolean(error)}
            required={block.required}
            {...common}
          />
        ) : !upload ? (
          <PreviewFileAnswer block={block} value={value} onChange={onChange} inputId={inputId} {...common} />
        ) : (
          <FileUploadAnswer
            block={block}
            value={value}
            controls={upload}
            inputId={inputId}
            invalid={Boolean(error)}
            {...common}
          />
        )}
      </div>

      {error ? (
        <p id={errorId} className="mt-2.5 text-caption text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

const FIVE = ["Rất tệ", "Tệ", "Bình thường", "Tốt", "Rất tốt"] as const;

/** StarRating captions: the Figma 5-point words, numbers beyond 5 stars. */
function ratingLabels(max: number): readonly string[] {
  return max === 5 ? FIVE : Array.from({ length: max }, (_, index) => `${index + 1} sao`);
}
