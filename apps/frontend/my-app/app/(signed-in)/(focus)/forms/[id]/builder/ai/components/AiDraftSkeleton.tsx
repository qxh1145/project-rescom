import { Icon } from "@/components/ui/Icon";

/**
 * Draft aside while the first draft is being written (canvas 13b₁): the panel
 * frame of `AiDraftPanel` with shimmering placeholder rows. The request is not
 * streamed, so there is no real question to show yet — only that work is going on.
 */
export function AiDraftSkeleton() {
  return (
    <aside className="flex h-full flex-col bg-surface" aria-label="Bản nháp khảo sát" aria-busy="true">
      <div className="flex items-center gap-2.5 px-4.5 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-tone-green-bg text-primary">
          <Icon name="file-text" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-body font-extrabold text-ink">Bản nháp khảo sát</p>
          <p className="text-[12px] text-ink-muted">Trợ lý đang dựng bản nháp…</p>
        </div>
        <button type="button" disabled className="h-11 rounded-field bg-disabled px-4.5 text-body-sm font-bold text-ink-muted">
          Mở trong Form Builder
        </button>
      </div>
      <IndeterminateBar />
      <div className="flex flex-1 flex-col gap-2.5 overflow-hidden bg-surface-muted px-4.5 py-4" aria-hidden="true">
        <div className="thought-skeleton h-[78px] rounded-control" />
        <div className="thought-skeleton mt-1.5 h-6.5 w-60 rounded-full" />
        {[0, 1, 2].map((i) => (
          <div key={`a${i}`} className="thought-skeleton h-18 rounded-control" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
        <div className="thought-skeleton mt-1.5 h-6.5 w-52 rounded-full" />
        {[0, 1].map((i) => (
          <div key={`b${i}`} className="thought-skeleton h-18 rounded-control" style={{ animationDelay: `${(i + 3) * 120}ms` }} />
        ))}
      </div>
    </aside>
  );
}

/** Thin sliding bar: progress without a percentage we could not honestly compute. */
export function IndeterminateBar() {
  return (
    <div className="relative h-[3px] overflow-hidden bg-line-subtle" role="progressbar" aria-label="Trợ lý đang soạn">
      <span className="thought-progress absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary" />
    </div>
  );
}
