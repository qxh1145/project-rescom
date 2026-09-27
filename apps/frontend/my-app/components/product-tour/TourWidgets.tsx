"use client";

import { Mascot } from "@/components/brand/Mascot";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useLiveRect, useTourTarget } from "./tour-dom";
import { useProductTour } from "./TourProvider";

/**
 * Canvas 20 kit "Nút Hướng dẫn": floating bottom-right on the app shell
 * (desktop); the yellow ring is tour progress. Hidden during a tour, while
 * the hub is open and once all tours are done.
 */
export function TourLauncher() {
  const tour = useProductTour();
  if (!tour.enabled || tour.active || tour.hubOpen || tour.allDone) return null;
  const length = 2 * Math.PI * 9;
  return (
    <button
      type="button"
      onClick={tour.openHub}
      aria-label={`Hướng dẫn, đã xong ${tour.completed} trên ${tour.total}`}
      className="fixed right-6 bottom-6 z-40 hidden h-13 items-center gap-2.5 rounded-full bg-ink pr-4.5 pl-3 text-body font-bold text-primary-foreground shadow-[0_10px_28px_rgba(14,18,38,0.28)] transition-[filter] hover:brightness-110 lg:inline-flex"
    >
      <svg aria-hidden width={30} height={30} viewBox="0 0 24 24">
        <circle cx={12} cy={12} r={9} fill="none" stroke="#3e466b" strokeWidth={3} />
        <circle
          cx={12}
          cy={12}
          r={9}
          fill="none"
          stroke="#fadc7a"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={length}
          strokeDashoffset={length * (1 - tour.completed / tour.total)}
          transform="rotate(-90 12 12)"
        />
      </svg>
      Hướng dẫn
      <span className="text-caption font-semibold text-[#c9cee0]">
        {tour.completed}/{tour.total}
      </span>
    </button>
  );
}

/** Pulsing yellow dot on a target (canvas 20C.0); a click starts the tour at that step. */
export function TourBeacon({ target, label, onClick }: { target: string; label: string; onClick: () => void }) {
  const element = useTourTarget(target);
  const rect = useLiveRect(element);
  if (!rect) return null;
  const left = rect.x + rect.width - 22;
  const top = rect.y + 4;
  return (
    <>
      <span aria-hidden className="tour-beacon z-40" style={{ left, top }} />
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="fixed z-40 size-11 rounded-full focus-visible:outline-tone-amber-accent"
        style={{ left: left - 13, top: top - 13 }}
      />
    </>
  );
}

/** Canvas 20C.0: non-blocking first-visit invite, bottom-right. */
export function TourInviteCard({
  title,
  body,
  startLabel,
  onStart,
  onLater,
}: {
  title: string;
  body: string;
  startLabel: string;
  onStart: () => void;
  onLater: () => void;
}) {
  return (
    <section
      aria-labelledby="tour-invite-title"
      className="fixed right-6 bottom-6 z-40 hidden w-105 items-start gap-3.5 rounded-[20px] border border-line bg-surface px-5 py-4.5 shadow-[0_18px_48px_rgba(14,18,38,0.22)] lg:flex"
    >
      <Mascot name="search" height={64} className="shrink-0" />
      <div className="flex flex-1 flex-col gap-2.5">
        <div className="flex flex-col gap-1">
          <h2 id="tour-invite-title" className="text-[17px] font-extrabold">
            {title}
          </h2>
          <p className="text-body-sm text-ink-strong">{body}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="md" radius="field" onClick={onStart} className="gap-2">
            {startLabel}
            <Icon name="arrow-right" size={18} />
          </Button>
          <Button variant="ghost" size="md" radius="field" className="text-ink" onClick={onLater}>
            Để sau
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Canvas 20 kit "Nhắc tiếp tục": once per sign-in session while a tour is unfinished. */
export function TourResumeToast({ text, onResume, onDismiss }: { text: string; onResume: () => void; onDismiss: () => void }) {
  return (
    <div
      role="status"
      className="fixed right-6 bottom-6 z-40 hidden w-100 items-center gap-3 rounded-2xl bg-ink px-4 py-3.5 text-primary-foreground shadow-[0_16px_40px_rgba(14,18,38,0.3)] lg:flex"
    >
      <Icon name="compass" size={22} className="shrink-0 text-tone-amber-accent" />
      <span className="flex-1 text-body-sm">{text}</span>
      <button
        type="button"
        onClick={onResume}
        className="h-10 shrink-0 rounded-[10px] bg-tone-amber-accent px-3 text-label font-extrabold text-ink hover:brightness-95"
      >
        Tiếp tục
      </button>
      <button type="button" onClick={onDismiss} aria-label="Ẩn nhắc" className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-white/10">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
