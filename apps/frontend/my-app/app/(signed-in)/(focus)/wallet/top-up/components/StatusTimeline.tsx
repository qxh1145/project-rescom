import { Icon } from "@/components/ui/Icon";
import type { TimelineStep } from "@/lib/wallet/top-up";

const STATE_TEXT: Record<TimelineStep["state"], string> = {
  done: "Đã xong",
  current: "Đang thực hiện",
  todo: "Chưa tới",
  failed: "Không thành công",
};

function Marker({ state }: { state: TimelineStep["state"] }) {
  if (state === "done") {
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon name="check-bold" size={16} />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full border-3 border-primary bg-surface">
        <span className="size-2.5 rounded-full bg-primary" />
      </span>
    );
  }
  if (state === "failed") {
    // ASSUMED (design): rejection is not drawn in Figma 14c.
    return (
      <span className="inline-flex size-7 items-center justify-center rounded-full bg-danger text-primary-foreground">
        <Icon name="x" size={16} />
      </span>
    );
  }
  return <span className="inline-block size-7 rounded-full border-2 border-line bg-surface" />;
}

/**
 * Figma 14c steps (62:2979–62:2992): 28px markers joined by a 2px line
 * (primary after a finished step, #E1E6EF otherwise).
 */
export function StatusTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={step.title} className={`relative flex gap-3.5 ${last ? "" : "pb-[22px]"}`}>
            {!last ? (
              <span
                aria-hidden
                className={`absolute top-[30px] -bottom-0.5 left-[13px] w-0.5 ${step.state === "done" ? "bg-primary" : "bg-line"}`}
              />
            ) : null}
            <span className="relative shrink-0">
              <Marker state={step.state} />
            </span>
            <div className="min-w-0 pt-px">
              <p
                className={`text-body ${
                  step.state === "current" ? "font-extrabold text-ink" : step.state === "todo" ? "font-bold text-ink-muted" : "font-bold text-ink"
                }`}
              >
                <span className="sr-only">{STATE_TEXT[step.state]}: </span>
                {step.title}
              </p>
              <p className={`text-caption ${step.state === "failed" ? "text-danger" : "text-ink-muted"}`}>{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
