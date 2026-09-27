"use client";

import type { ProductTourId } from "@rescom/schemas";
import { Mascot } from "@/components/brand/Mascot";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { tourById } from "@/lib/product-tour/tour-definitions";

const stepsOf = (id: ProductTourId) => `${tourById(id).steps.length} bước`;

/** Canvas 20.1: invite after onboarding, on Khám phá. */
export function TourWelcomeDialog({
  open,
  displayName,
  publishLocked,
  onStart,
  onLater,
}: {
  open: boolean;
  displayName: string;
  publishLocked: boolean;
  onStart: (tourId: ProductTourId) => void;
  onLater: () => void;
}) {
  const name = displayName.trim().split(/\s+/).at(-1);
  return (
    <Dialog open={open} onClose={onLater} labelledBy="tour-welcome-title" width={640}>
      <div className="flex flex-col gap-5.5 px-9 pt-8 pb-8">
        <div className="flex items-center gap-4.5">
          <Mascot name="wave" height={104} className="shrink-0" />
          <div className="flex flex-col gap-2">
            <p className="text-[12px] font-extrabold tracking-[0.6px] text-primary-strong uppercase">Hướng dẫn nhanh</p>
            <h2 id="tour-welcome-title" className="text-[26px] leading-[1.25] font-extrabold tracking-[-0.5px]">
              {name ? `Chào ${name}, thử một vòng cùng Rescom nhé?` : "Thử một vòng cùng Rescom nhé?"}
            </h2>
            <p className="text-body-relaxed text-ink-strong">
              Bạn làm thật ngay trên màn hình, Rescom chỉ đường từng bước. Chọn việc muốn làm trước.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <TourOption
            icon="play-circle"
            title="Làm khảo sát đầu tiên"
            meta={`${stepsOf("FIRST_SURVEY")} · mở khoá 100 điểm khởi đầu`}
            badge="Nên làm trước"
            onClick={() => onStart("FIRST_SURVEY")}
          />
          <TourOption
            icon="form-layout"
            title="Soạn form bằng Form Builder"
            meta={`${stepsOf("FORM_BUILDER")} · kéo thả câu hỏi, câu kiểm tra chú ý`}
            onClick={() => onStart("FORM_BUILDER")}
          />
          <TourOption
            icon="bar-chart"
            title="Đăng khảo sát đầu tiên"
            meta={`${stepsOf("FIRST_PUBLISH")} · ${publishLocked ? "mở sau khi có điểm khả dụng" : "từ link Google Forms đến mã hoàn thành"}`}
            locked={publishLocked}
            onClick={() => onStart("FIRST_PUBLISH")}
          />
        </div>

        <div className="flex items-center gap-4 border-t border-line-subtle pt-3.5">
          <p className="text-caption-relaxed text-ink-muted">
            Mở lại bất cứ lúc nào ở nút <strong className="text-ink">Hướng dẫn</strong> góc dưới bên phải.
          </p>
          <Button variant="secondary" size="md" radius="field" className="ml-auto shrink-0" onClick={onLater}>
            Để sau
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TourOption({
  icon,
  title,
  meta,
  badge,
  locked = false,
  onClick,
}: {
  icon: string;
  title: string;
  meta: string;
  badge?: string;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={locked}
      className={[
        "flex min-h-19 w-full items-center gap-3.5 rounded-2xl border px-4 py-3 text-left transition-colors",
        locked
          ? "cursor-not-allowed border-dashed border-line-strong bg-surface-muted"
          : badge
            ? "border-primary bg-tone-green-tint hover:bg-tone-green-bg"
            : "border-line-strong bg-surface hover:bg-surface-subtle",
      ].join(" ")}
    >
      <span
        className={`flex size-12 shrink-0 items-center justify-center rounded-[14px] ${locked ? "bg-surface-subtle text-ink-muted" : "bg-tone-green-bg text-primary-strong"}`}
      >
        <Icon name={icon} size={22} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className={`text-lead font-extrabold ${locked ? "text-ink-muted" : "text-ink"}`}>{title}</span>
          {badge ? (
            <span className="rounded-full bg-tone-amber-bg px-2.5 py-0.5 text-[12px] font-extrabold text-tone-amber-fg">{badge}</span>
          ) : null}
        </span>
        <span className="text-caption text-ink-muted">{meta}</span>
      </span>
      <Icon name={locked ? "lock" : "arrow-right"} size={20} className={locked ? "text-ink-muted" : "text-primary-strong"} />
    </button>
  );
}

/** Canvas 20A · Hoàn thành: shown when "Làm khảo sát đầu tiên" ends. */
export function TourDoneDialog({
  open,
  completed,
  total,
  publishLocked,
  onNextTour,
  onClose,
}: {
  open: boolean;
  completed: number;
  total: number;
  publishLocked: boolean;
  onNextTour: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} labelledBy="tour-done-title" width={560}>
      <div className="flex flex-col items-center gap-4.5 px-10 pt-9 pb-8 text-center">
        <Mascot name="trophy" height={132} />
        <span className="inline-flex h-7.5 items-center gap-1.5 rounded-full bg-tone-amber-bg px-3 text-caption font-extrabold text-tone-amber-fg">
          <Icon name="check" size={14} />
          Hướng dẫn {completed}/{total} hoàn thành
        </span>
        <h2 id="tour-done-title" className="text-[28px] leading-[1.25] font-extrabold tracking-[-0.5px]">
          Xong! Bạn đã biết cách nhận điểm
        </h2>
        <p className="max-w-110 text-body-relaxed text-ink-strong">
          Bạn đã biết cách chọn khảo sát, lấy mã và nhận điểm. Khi 100 điểm khởi đầu mở khoá, dùng chúng để đăng khảo sát của bạn.
        </p>
        <div aria-hidden className="flex w-full gap-1.5">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={`h-2 flex-1 rounded-full ${index < completed ? "bg-primary" : "bg-line"}`} />
          ))}
        </div>
        <div className="flex w-full flex-col gap-2.5">
          <Button fullWidth radius="field" onClick={onNextTour} disabled={publishLocked}>
            {publishLocked ? "Đăng khảo sát mở khi có điểm khả dụng" : "Tiếp: Đăng khảo sát đầu tiên"}
          </Button>
          <Button variant="ghost" fullWidth radius="field" size="md" className="text-ink" onClick={onClose}>
            Để sau
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Canvas 20 kit "Xác nhận dừng": ✕ or Esc mid-tour. */
export function TourStopDialog({
  open,
  stepLabel,
  onContinue,
  onStop,
}: {
  open: boolean;
  stepLabel: string;
  onContinue: () => void;
  onStop: () => void;
}) {
  return (
    <Dialog open={open} onClose={onContinue} labelledBy="tour-stop-title" width={420}>
      <div className="flex flex-col gap-3.5 p-6">
        <h2 id="tour-stop-title" className="text-[18px] font-extrabold">
          Dừng hướng dẫn ở đây?
        </h2>
        <p className="text-body-sm text-ink-strong">
          Rescom nhớ bạn dừng ở {stepLabel}. Tiếp tục bất cứ lúc nào ở nút Hướng dẫn, Rescom sẽ không tự mời lại.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="md" radius="field" onClick={onStop}>
            Dừng
          </Button>
          <Button size="md" radius="field" onClick={onContinue} autoFocus>
            Tiếp tục hướng dẫn
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
