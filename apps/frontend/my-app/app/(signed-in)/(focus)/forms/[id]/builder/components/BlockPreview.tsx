import type { FormBlock } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";

/**
 * Read-only answer area of a canvas card (Figma 13a 72:269…72:418): what the
 * respondent will see, drawn from the block settings. Editing happens in the
 * properties panel.
 */
export function BlockPreview({ block }: { block: FormBlock }) {
  switch (block.type) {
    case "single_choice":
    case "multiple_choice":
      return (
        <ul className="flex flex-col gap-4" aria-label="Các lựa chọn">
          {block.options.map((option) => (
            <li key={option.id} className="flex items-center gap-2.5 text-body-sm text-ink-strong">
              <span
                aria-hidden="true"
                className={`size-4.5 shrink-0 border border-line-strong ${block.type === "single_choice" ? "rounded-full" : "rounded-[5px]"}`}
              />
              {option.label}
            </li>
          ))}
          {block.allowOther ? (
            <li className="flex items-center gap-2.5 text-body-sm text-ink-muted">
              <span aria-hidden="true" className="size-4.5 shrink-0 rounded-full border border-line-strong" />
              Khác…
            </li>
          ) : null}
        </ul>
      );
    case "linear_scale": {
      const values: number[] = [];
      for (let v = block.min; v <= block.max; v += block.step || 1) values.push(v);
      return (
        <div className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
          {block.minLabel ? <span className="mr-1">{block.minLabel}</span> : null}
          {values.map((value) => (
            <span
              key={value}
              className="flex size-9 items-center justify-center rounded-full border border-line-strong text-caption font-bold text-ink"
            >
              {value}
            </span>
          ))}
          {block.maxLabel ? <span className="ml-1">{block.maxLabel}</span> : null}
        </div>
      );
    }
    case "rating":
      return (
        <div className="flex gap-1.5 text-line-strong" aria-label={`Thang ${block.maxRating} sao`}>
          {Array.from({ length: block.maxRating }, (_, i) =>
            block.ratingShape === "NUMBER" ? (
              <span key={i} className="flex size-9 items-center justify-center rounded-full border border-line-strong text-caption font-bold text-ink">
                {i + 1}
              </span>
            ) : (
              <Icon key={i} name="star-empty" size={26} />
            ),
          )}
        </div>
      );
    case "textarea":
      return (
        <div className="flex h-14.5 items-start rounded-field border border-dashed border-line bg-surface-muted px-3 pt-4 text-caption text-ink-muted">
          {block.placeholder || "Người trả lời nhập đoạn văn ở đây"}
        </div>
      );
    case "text":
    case "number":
      return (
        <div className="flex h-11 items-center rounded-field border border-dashed border-line bg-surface-muted px-3 text-caption text-ink-muted">
          {block.placeholder || (block.type === "number" ? "Người trả lời nhập số" : "Người trả lời nhập câu trả lời ngắn")}
        </div>
      );
    case "date":
      return (
        <div className="flex h-11 w-60 items-center justify-between rounded-field border border-dashed border-line bg-surface-muted px-3 text-caption text-ink-muted">
          dd/mm/yyyy
          <Icon name="calendar" size={18} />
        </div>
      );
    case "file_upload":
      return (
        <div className="flex h-14.5 items-center gap-2 rounded-field border border-dashed border-line bg-surface-muted px-3 text-caption text-ink-muted">
          <Icon name="upload" size={18} />
          Tối đa {block.maxFiles} tệp · {block.maxFileSizeMb} MB mỗi tệp
        </div>
      );
  }
}
