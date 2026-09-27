"use client";

import { useId } from "react";

const DEFAULT_LABELS = ["Rất tệ", "Tệ", "Bình thường", "Tốt", "Rất tốt"] as const;

interface StarRatingProps {
  value: number | null;
  onChange: (value: number) => void;
  /** Star box size: 32 (mobile), 40 (desktop). */
  size?: 32 | 40;
  /** Gap between stars in px (Figma: 4 on page 8, 14–16 in the rating form). */
  gap?: number;
  legend: string;
  labels?: readonly string[];
}

/**
 * Figma "Đánh giá sao" (page 8): empty outline stars; active stars #F2B705
 * with a #9A6700 border; the caption reads "4/5 · Tốt". Radio group underneath.
 */
export function StarRating({ value, onChange, size = 32, gap = 4, legend, labels = DEFAULT_LABELS }: StarRatingProps) {
  const name = useId();
  return (
    <fieldset className="flex items-center gap-3">
      <legend className="sr-only">{legend}</legend>
      <div className="flex" style={{ gap }}>
        {labels.map((label, index) => {
          const star = index + 1;
          const active = value !== null && star <= value;
          return (
            <label key={star} className="cursor-pointer rounded-md has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-primary">
              <input
                type="radio"
                name={name}
                value={star}
                checked={value === star}
                onChange={() => onChange(star)}
                className="sr-only"
                aria-label={`${star}/5 · ${label}`}
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- two-tone star asset */}
              <img
                alt=""
                src={active ? "/icons/star-filled.svg" : "/icons/star-empty.svg"}
                width={size}
                height={size}
                style={{ width: size, height: size }}
              />
            </label>
          );
        })}
      </div>
      {value ? (
        <span className="text-label font-bold text-ink">
          {value}/5 · {labels[value - 1]}
        </span>
      ) : null}
    </fieldset>
  );
}
