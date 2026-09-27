"use client";

import Link from "next/link";
import { Mascot } from "@/components/brand/Mascot";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/Spinner";
import { formsListErrorMessage } from "@/lib/forms/manage-messages";
import { MANAGE_FILTERS, type ManageFilter } from "@/lib/forms/manage-status";
import { useMyForms } from "../hooks/use-my-forms";
import { FormCards } from "./FormCards";
import { FormsTable } from "./FormsTable";

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3.5 py-3 lg:rounded-[18px] lg:px-4.5 lg:py-3.75">
      <p className="text-[12px] font-semibold text-ink-muted lg:text-caption">{label}</p>
      <p className={`mt-0.5 text-[22px] font-extrabold lg:text-[28px] ${accent ? "text-tone-amber-fg" : "text-ink"}`}>{value}</p>
    </div>
  );
}

/** Figma 10 mobile "Lọc theo trạng thái" (63:1313): scrolling pills, the active one ink-filled with a check. */
function FilterChips({
  filter,
  onChange,
  total,
}: {
  filter: ManageFilter;
  onChange: (value: ManageFilter) => void;
  total: number;
}) {
  return (
    <div role="group" aria-label="Lọc theo trạng thái" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
      {MANAGE_FILTERS.map((item) => {
        const active = item.value === filter;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={[
              "inline-flex h-9.5 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-label whitespace-nowrap",
              active ? "border-ink bg-ink font-bold text-primary-foreground" : "border-line-strong bg-surface font-semibold text-ink",
            ].join(" ")}
          >
            {active ? <Icon name="check" size={14} /> : null}
            {item.value === "all" ? `${item.label} · ${total}` : item.label}
          </button>
        );
      })}
    </div>
  );
}

function EmptyState() {
  return (
    <section aria-labelledby="my-forms-empty" className="mx-auto flex max-w-[360px] flex-col items-center py-8 text-center">
      <Mascot name="create" height={150} />
      <h2 id="my-forms-empty" className="mt-3 text-title-sm font-extrabold text-ink">
        Bạn chưa có khảo sát nào
      </h2>
      <p className="mt-2.5 text-body-relaxed text-ink-muted">
        Tạo khảo sát bằng Google Forms hoặc Form Builder, dùng điểm để tìm người trả lời.
      </p>
      <Link href="/forms/new" className={buttonClassName({ size: "base", className: "mt-5" })}>
        Tạo khảo sát mới
      </Link>
    </section>
  );
}

/**
 * Figma 10 "Khảo sát của tôi" — desktop 63:127 (stat cards + table), mobile
 * 63:1300 (two stat cards, filter pills, cards). Empty / filter-empty states
 * are ASSUMED (not drawn).
 */
export function MyFormsScreen() {
  const { loaded, loading, error, reload, rows, visible, stats, filter, setFilter, now } = useMyForms();
  const segments = MANAGE_FILTERS.map((item) =>
    item.value === "all" ? { value: item.value, label: `${item.label} · ${rows.length}` } : item,
  );

  return (
    <>
      <header className="sticky top-0 z-30 bg-surface pt-[max(env(safe-area-inset-top),8px)] lg:hidden">
        <div className="flex h-15 items-center gap-3 px-5">
          <h1 className="mr-auto text-[22px] font-extrabold text-ink">Khảo sát của tôi</h1>
          <Link
            href="/forms/new"
            className="inline-flex h-11 items-center gap-1.5 rounded-full bg-primary pr-4 pl-3 text-body font-bold text-primary-foreground hover:bg-primary-hover"
          >
            <Icon name="plus" size={18} />
            Tạo mới
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-8 lg:pb-12">
        <div className="hidden items-center justify-between gap-4 lg:flex">
          <h1 className="text-[28px] font-extrabold tracking-[-0.3px] text-ink">Khảo sát của tôi</h1>
          <Link href="/forms/new" className={buttonClassName({ size: "base", className: "pr-5 pl-4.5" })}>
            <Icon name="plus" size={18} />
            <span>Tạo khảo sát mới</span>
          </Link>
        </div>

        {error && !loaded ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start lg:mt-6">
            <Alert tone="danger" className="flex-1">
              {formsListErrorMessage(error)}
            </Alert>
            <Button variant="secondary" size="base" radius="field" onClick={reload}>
              Thử lại
            </Button>
          </div>
        ) : !loaded ? (
          <p className="flex items-center gap-3 py-16 text-body text-ink-muted" role="status" aria-busy={loading}>
            <Spinner className="size-5 text-primary" />
            Đang tải khảo sát của bạn…
          </p>
        ) : rows.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <section aria-label="Tổng quan" className="grid grid-cols-2 gap-2.5 lg:mt-6 lg:grid-cols-4 lg:gap-4">
              <div className="hidden lg:block">
                <StatCard label="Đang chạy" value={String(stats.running)} />
              </div>
              <div className="hidden lg:block">
                <StatCard label="Chờ Admin duyệt" value={String(stats.pendingReview)} />
              </div>
              <StatCard
                label="Đang khoá ký quỹ"
                value={stats.escrowLocked === null ? "—" : `${stats.escrowLocked} điểm`}
                accent
              />
              <StatCard label="Tổng lượt hoàn thành" value={String(stats.completed)} />
            </section>

            <div className="mt-4 lg:hidden">
              <FilterChips filter={filter} onChange={setFilter} total={rows.length} />
            </div>

            <section
              aria-label="Danh sách khảo sát"
              className="mt-4 lg:mt-6 lg:rounded-card lg:border lg:border-line lg:bg-surface lg:p-6"
            >
              <div className="hidden lg:block">
                <SegmentedControl
                  segments={segments}
                  value={filter}
                  onChange={setFilter}
                  label="Lọc theo trạng thái"
                  variant="bordered"
                />
              </div>
              {visible.length === 0 ? (
                <p className="py-10 text-center text-body text-ink-muted">Không có khảo sát nào ở mục này.</p>
              ) : (
                <>
                  <div className="hidden lg:block">
                    <FormsTable rows={visible} now={now} onChanged={reload} />
                  </div>
                  <div className="lg:hidden">
                    <FormCards rows={visible} now={now} onChanged={reload} />
                  </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}
