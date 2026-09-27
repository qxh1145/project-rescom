import { Mascot } from "@/components/brand/Mascot";
import type { VisibleActivation } from "@/lib/economy/starter-points-service";

/** Yellow-on-green progress (Figma 62:622): track #5E9D64, fill #FADC7A. */
function StepProgress({ view, className }: { view: VisibleActivation; className: string }) {
  return (
    <div
      role="progressbar"
      aria-label="Tiến độ kích hoạt tài khoản"
      aria-valuemin={0}
      aria-valuemax={view.totalSteps}
      aria-valuenow={view.completedSteps}
      aria-valuetext={`Đã xong ${view.completedSteps}/${view.totalSteps} bước`}
      className={`h-2 overflow-hidden rounded-full bg-activation-track ${className}`}
    >
      <div
        className="h-full rounded-full bg-tone-amber-accent"
        style={{ width: `${(view.completedSteps / view.totalSteps) * 100}%` }}
      />
    </div>
  );
}

/**
 * Activation step 2/2 — desktop banner 62:619 (1052 × 150, 24px radius),
 * mobile card 62:1262 (350 × 125, 20px radius). Shown until the first survey
 * unlocks the frozen starter points.
 */
export function ActivationBanner({ view }: { view: VisibleActivation }) {
  const waiting = view.awaitingConfirmation;
  return (
    <section
      aria-labelledby="activation-title"
      data-tour="activation-banner"
      className="relative overflow-hidden rounded-[20px] bg-primary p-4.5 text-primary-foreground lg:h-[150px] lg:rounded-card lg:px-9 lg:pb-0 lg:pt-[38px]"
    >
      <div className="relative z-10 max-w-[212px] lg:max-w-none">
        <p className="text-[12px] font-bold tracking-[0.5px]">
          BƯỚC 2/2<span className="hidden lg:inline"> · KÍCH HOẠT TÀI KHOẢN</span>
        </p>
        <h2 id="activation-title" className="mt-2 text-[17px] font-extrabold leading-[23px] lg:mt-2.5 lg:text-[24px] lg:leading-normal lg:tracking-[-0.2px]">
          {waiting ? (
            // ASSUMED copy: Google Forms completion under its 48h review (not drawn).
            <>Khảo sát đầu tiên đang được đối soát — {view.amount} điểm sẽ mở khoá khi xác nhận</>
          ) : (
            <>
              Làm 1 khảo sát bất kỳ để mở khoá {view.amount} điểm<span className="hidden lg:inline"> khởi đầu</span>
            </>
          )}
        </h2>
        <StepProgress view={view} className="mt-2.5 w-[212px] lg:w-[420px]" />
      </div>
      <span aria-hidden className="absolute -right-0.5 top-[15px] lg:hidden">
        <Mascot name="points" height={124} />
      </span>
      <span aria-hidden className="absolute right-11 top-5 hidden lg:block">
        <Mascot name="points" height={170} />
      </span>
    </section>
  );
}
