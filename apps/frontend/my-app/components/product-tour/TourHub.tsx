"use client";

import { useEffect, useRef } from "react";
import type { ProductTourId, ProductTourProgressDto } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { TOURS } from "@/lib/product-tour/tour-definitions";
import { completedCount, isTourLocked, tourHubView } from "@/lib/product-tour/tour-logic";

interface TourHubProps {
  open: boolean;
  progress: readonly ProductTourProgressDto[];
  availablePoints: number | null;
  hintsEnabled: boolean;
  onHintsChange: (enabled: boolean) => void;
  onStart: (tourId: ProductTourId, fromStep: number) => void;
  onClose: () => void;
}

/**
 * Canvas 20.2 "Trung tâm hướng dẫn": right drawer listing the four tours with
 * done / in progress / not started / locked. Native modal <dialog> for the
 * focus trap and Esc.
 */
export function TourHub({ open, progress, availablePoints, hintsEnabled, onHintsChange, onStart, onClose }: TourHubProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const done = completedCount(progress);
  const total = TOURS.length;

  return (
    <dialog
      ref={ref}
      aria-labelledby="tour-hub-title"
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-115 max-w-full bg-surface p-0 text-ink shadow-[-24px_0_60px_rgba(8,12,32,0.3)] backdrop:bg-[rgba(14,18,38,0.72)]"
    >
      {open ? (
        <div className="flex h-full flex-col gap-5 px-8 py-7">
          <div className="flex items-start gap-3">
            <div className="flex flex-col gap-1.5">
              <h2 id="tour-hub-title" className="text-[24px] font-extrabold tracking-[-0.2px]">
                Bắt đầu với Rescom
              </h2>
              <p className="text-body-sm text-ink-muted">Làm thật trên màn hình, mỗi hướng dẫn vài bước.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng Trung tâm hướng dẫn"
              className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-subtle hover:bg-line"
            >
              <Icon name="x" size={18} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <p className="flex justify-between text-caption font-bold">
              <span>
                {done}/{total} hướng dẫn
              </span>
              <span className="font-semibold text-ink-muted">{Math.round((done / total) * 100)}%</span>
            </p>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-label={`Đã xong ${done} trên ${total} hướng dẫn`}
              className="h-2 overflow-hidden rounded-full bg-line"
            >
              <div className="h-full rounded-full bg-primary" style={{ width: `${(done / total) * 100}%` }} />
            </div>
          </div>

          <ul className="flex flex-col">
            {TOURS.map((tour) => {
              const view = tourHubView(progress, tour.id);
              const locked = view.state !== "done" && isTourLocked(tour.id, availablePoints);
              const meta = locked
                ? "Mở khi bạn có điểm khả dụng"
                : view.state === "done"
                  ? "Đã xong"
                  : view.state === "doing"
                    ? `Dừng ở bước ${view.step + 1}/${tour.steps.length}`
                    : `${tour.steps.length} bước · ${tour.summary}`;
              return (
                <li key={tour.id} className="flex items-center gap-3.5 border-t border-line-subtle py-4">
                  <StatusIcon state={locked ? "locked" : view.state} progress={(view.step + 1) / tour.steps.length} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={`text-body font-bold ${locked ? "text-ink-muted" : "text-ink"}`}>{tour.title}</span>
                    <span className="text-caption text-ink-muted">{meta}</span>
                  </div>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onStart(tour.id, view.state === "doing" ? view.step : 0)}
                    className={[
                      "h-10 shrink-0 rounded-[10px] px-3.5 text-label font-bold",
                      locked
                        ? "cursor-not-allowed border border-line-strong/50 bg-surface-muted text-ink-muted"
                        : view.state === "doing"
                          ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                          : "border border-line-strong bg-surface text-ink hover:bg-surface-subtle",
                    ].join(" ")}
                  >
                    {view.state === "done" ? "Xem lại" : view.state === "doing" ? "Tiếp tục" : "Bắt đầu"}
                  </button>
                </li>
              );
            })}
          </ul>

          <label className="mt-auto flex cursor-pointer items-start gap-3 rounded-2xl bg-surface-muted p-4">
            <input
              type="checkbox"
              role="switch"
              checked={hintsEnabled}
              onChange={(event) => onHintsChange(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-label font-bold">Hiện chấm gợi ý ở màn hình mới</span>
              <span className="text-caption-relaxed text-ink-muted">
                Lần đầu mở trang Theo dõi hay Form Builder, Rescom đánh dấu chỗ đáng xem bằng chấm vàng.
              </span>
            </span>
          </label>
        </div>
      ) : null}
    </dialog>
  );
}

function StatusIcon({ state, progress }: { state: "todo" | "doing" | "done" | "locked"; progress: number }) {
  if (state === "done") {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon name="check" size={18} />
      </span>
    );
  }
  if (state === "locked") {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink-muted">
        <Icon name="lock" size={17} />
      </span>
    );
  }
  if (state === "doing") {
    const length = 2 * Math.PI * 15;
    return (
      <svg aria-hidden width={36} height={36} viewBox="0 0 36 36" className="shrink-0">
        <circle cx={18} cy={18} r={15} fill="none" stroke="#e1e6ef" strokeWidth={4} />
        <circle
          cx={18}
          cy={18}
          r={15}
          fill="none"
          stroke="#2b7a33"
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - Math.min(1, progress))}
          transform="rotate(-90 18 18)"
        />
      </svg>
    );
  }
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-line-strong text-ink">
      <Icon name="play-circle" size={18} />
    </span>
  );
}
