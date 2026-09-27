"use client";

import { useId, type FormEvent, type KeyboardEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { AI_DURATION_BUCKETS, AI_DURATION_LABELS, type AiMessageOptions } from "@/lib/forms/builder-ai";

interface AiComposerProps {
  value: string;
  onChange: (value: string) => void;
  options: AiMessageOptions;
  onOptionsChange: (options: AiMessageOptions) => void;
  onSubmit: () => void;
  busy: boolean;
  placeholder: string;
  /** Entry screen (13b) uses the long "Gợi ý câu kiểm tra chú ý" label. */
  variant: "entry" | "chat";
  rows?: number;
}

/**
 * Prompt box of 13b / 13b' (62:3254, 62:2412): textarea, duration chip,
 * attention-check chip (toggle) and the round send button. Enter sends,
 * Shift+Enter adds a line.
 */
export function AiComposer({ value, onChange, options, onOptionsChange, onSubmit, busy, placeholder, variant, rows = 3 }: AiComposerProps) {
  const id = useId();
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!busy && value.trim()) onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };
  return (
    <form
      onSubmit={submit}
      className={`flex flex-col gap-3 border border-line bg-surface px-4.5 pt-3 pb-3 shadow-[0_6px_12px_rgba(30,36,70,0.07)] ${
        variant === "entry" ? "rounded-card" : "rounded-[20px]"
      }`}
    >
      <label htmlFor={`${id}-prompt`} className="sr-only">
        Mô tả khảo sát cho trợ lý
      </label>
      <textarea
        id={`${id}-prompt`}
        value={value}
        rows={rows}
        maxLength={4000}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none bg-transparent text-lead leading-[24.8px] text-ink placeholder:text-ink-muted focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <label className="relative inline-flex h-9 items-center rounded-full border border-line bg-surface pr-7 pl-3 text-caption font-semibold text-ink-strong">
          <Icon name="clock" size={16} className="mr-1.5" />
          <span className="sr-only">Thời lượng mong muốn</span>
          <select
            value={options.duration}
            onChange={(event) => onOptionsChange({ ...options, duration: event.target.value as AiMessageOptions["duration"] })}
            className="appearance-none bg-transparent text-caption font-semibold focus:outline-none"
          >
            {AI_DURATION_BUCKETS.map((bucket) => (
              <option key={bucket} value={bucket}>
                {AI_DURATION_LABELS[bucket]}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-2.5" />
        </label>
        <button
          type="button"
          aria-pressed={options.suggestAttentionChecks}
          onClick={() => onOptionsChange({ ...options, suggestAttentionChecks: !options.suggestAttentionChecks })}
          className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-caption font-semibold ${
            options.suggestAttentionChecks
              ? "border-tone-amber-line bg-tone-amber-bg text-tone-amber-fg"
              : "border-line bg-surface text-ink-muted"
          }`}
        >
          <Icon name="shield-check" size={16} />
          {variant === "entry" ? "Gợi ý câu kiểm tra chú ý" : "Kiểm tra chú ý"}
        </button>
        <button
          type="submit"
          aria-label="Gửi"
          disabled={busy || !value.trim()}
          aria-busy={busy || undefined}
          className="ml-auto flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-surface disabled:opacity-50"
        >
          {busy ? <Spinner className="size-5" /> : <Icon name="arrow-up" size={20} />}
        </button>
      </div>
    </form>
  );
}
