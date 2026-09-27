import Link from "next/link";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatShortDateTime } from "@/lib/participation/completion-view";
import { CompletionDesktopHeader } from "./CompletionParts";

/**
 * Figma 17c "Điểm đang giữ để xét (ENFORCED)" (63:3676, mobile only): shown
 * instead of the plain success when the reward sits in Integrity Hold.
 * Desktop is derived (ASSUMED): the same column, 560px, under the completion header.
 */
export function HeldView({ amount, surveyTitle, submittedAt }: { amount: number; surveyTitle: string; submittedAt: string | null }) {
  const when = formatShortDateTime(submittedAt);
  const back = (
    <Link href="/wallet" className={buttonClassName({ variant: "secondary", size: "lg", radius: "field", fullWidth: true })}>
      Về Ví điểm
    </Link>
  );

  return (
    <>
      <CompletionDesktopHeader />
      <MobileBackBar title="Điểm đang giữ để xét" backHref="/marketplace" />
      <main className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-[560px] flex-col px-4 pt-[18px] pb-8 lg:px-0 lg:pt-10">
          <h1 className="mb-5 hidden text-title font-extrabold text-ink lg:block">Điểm đang giữ để xét</h1>

          <section className="flex flex-col items-start rounded-[20px] bg-tone-amber-bg px-[18px] pt-[18px] pb-5">
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-surface px-2.5 text-[12px] font-bold text-tone-amber-fg">
              <Icon name="hourglass" size={14} />
              Đang xét chất lượng
            </span>
            <p className="mt-1.5 text-[34px] font-extrabold text-ink">+{amount} điểm</p>
            <p className="mt-1 text-body-sm text-tone-amber-ink">
              {surveyTitle}
              {when ? ` · nộp ${when}` : ""}
            </p>
          </section>

          <ol className="mt-4 flex flex-col rounded-[20px] border border-line bg-surface px-[18px] pt-[18px] pb-5">
            <li className="relative flex gap-3.5 pb-4">
              <span className="absolute top-[30px] bottom-0 left-[13px] w-0.5 bg-primary" aria-hidden="true" />
              <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Icon name="check-bold" size={16} />
              </span>
              <div className="flex flex-col">
                <p className="text-body font-bold text-ink">Đã nộp bài</p>
                <p className="text-caption leading-[19.5px] text-ink-muted">Câu trả lời đã được lưu an toàn.</p>
              </div>
            </li>
            <li className="relative flex gap-3.5 pb-4" aria-current="step">
              <span className="absolute top-[30px] bottom-0 left-[13px] w-0.5 bg-line" aria-hidden="true" />
              <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full border-3 border-rating-border bg-surface">
                <span className="size-2.5 rounded-full bg-rating-border" />
              </span>
              <div className="flex flex-col">
                <p className="text-body font-extrabold text-ink">Điểm đang được giữ</p>
                <p className="text-caption leading-[19.5px] text-ink-muted">
                  Chưa dùng được trong lúc Rescom xét chất lượng câu trả lời.
                </p>
              </div>
            </li>
            <li className="flex gap-3.5">
              <span className="size-7 shrink-0 rounded-full border-2 border-line bg-surface" aria-hidden="true" />
              <div className="flex flex-col">
                <p className="text-body font-bold text-ink">Có kết quả</p>
                <p className="text-caption leading-[19.5px] text-ink-muted">
                  Đạt: điểm vào Khả dụng. Cần xem thêm: một người sẽ xem lại, điểm vẫn được giữ.
                </p>
              </div>
            </li>
          </ol>

          <p className="mt-4 text-body-sm leading-[21.7px] text-ink-strong">
            <strong className="font-bold text-ink">Cần xem thêm không có nghĩa là gian lận.</strong> Nếu không đồng ý với
            kết quả cuối, bạn có thể khiếu nại.
          </p>
          {/* ASSUMED: Figma leaves "[THỜI HẠN]" open; no decision deadline is defined yet. */}
          <p className="mt-2 text-body-sm leading-[21.7px] text-ink-strong">
            Nếu quá thời hạn xét mà chưa có kết quả, điểm tự động vào Khả dụng.
          </p>

          <div className="mt-8 hidden lg:block">{back}</div>
        </div>
        <div className="sticky bottom-0 mt-auto border-t border-line bg-surface px-4 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] lg:hidden">
          {back}
        </div>
      </main>
    </>
  );
}
