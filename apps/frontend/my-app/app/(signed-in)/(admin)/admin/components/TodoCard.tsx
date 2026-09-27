import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { OVERVIEW_TODO_EMPTY } from "@/lib/admin/overview-messages";
import type { TodoRowView, TodoTone } from "@/lib/admin/overview-view";

const TILE_TONES: Record<TodoTone, string> = {
  danger: "bg-danger-soft text-danger",
  neutral: "bg-surface-subtle text-ink-strong",
  amber: "bg-tone-amber-bg text-tone-amber-fg",
  blue: "bg-tone-blue-bg text-tone-blue-fg",
};

/** Figma 62:4142 "Việc cần làm · cũ nhất trước": 66px link rows, 36px icon tiles. */
export function TodoCard({ rows }: { rows: TodoRowView[] }) {
  return (
    <section aria-labelledby="admin-todo-title" className="rounded-[22px] border border-line bg-surface px-6 pt-5 pb-6">
      <h2 id="admin-todo-title" className="text-[17px] font-extrabold text-ink">
        Việc cần làm · cũ nhất trước
      </h2>
      {rows.length === 0 ? (
        <p className="mt-4 border-t border-line-subtle pt-4 text-body-sm text-ink-muted">{OVERVIEW_TODO_EMPTY}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                href={row.href}
                className="group flex min-h-16.5 items-center gap-3 border-t border-line-subtle py-2"
              >
                <span
                  className={`inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] ${TILE_TONES[row.tone]}`}
                >
                  <Icon name={row.icon} size={18} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-body font-bold text-ink group-hover:text-primary">{row.title}</span>
                  <span className="truncate text-caption text-ink-muted">{row.subtitle}</span>
                </span>
                {row.trailing ? (
                  <span
                    className={`shrink-0 text-caption ${
                      row.trailing.tone === "danger" ? "font-bold text-danger-strong" : "text-ink-muted"
                    }`}
                  >
                    {row.trailing.text}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
