import Link from "next/link";
import { Mascot } from "@/components/brand/Mascot";
import { Icon } from "@/components/ui/Icon";
import { formatPoints } from "@/lib/wallet/top-up";

/** Where "Tạo khảo sát" leads (`app/forms/new`, the survey creation entry). */
export const CREATE_SURVEY_HREF = "/forms/new";

/**
 * Figma 7 "Điểm khả dụng" card — desktop 62:243 (440 × 209, 60px number,
 * one white CTA), mobile 62:1059 (168px, 44px number, "Nạp điểm" + "Tạo khảo sát").
 */
export function BalanceCard({ available }: { available: number }) {
  return (
    <section
      aria-labelledby="wallet-available-label"
      className="relative overflow-hidden rounded-[22px] bg-primary px-5 pt-5 pb-5 text-primary-foreground lg:rounded-card lg:px-7 lg:pt-7 lg:pb-7"
    >
      <Mascot name="points" height={110} className="pointer-events-none absolute -right-px top-1.5 lg:hidden" />
      <Mascot name="points" height={140} className="pointer-events-none absolute right-3.5 top-2 hidden lg:block" />
      <h2 id="wallet-available-label" className="relative text-label font-semibold lg:text-body">
        Điểm khả dụng
      </h2>
      <p className="relative mt-1 text-[44px] font-extrabold leading-[44px] tracking-[-0.9px] lg:mt-1.5 lg:text-[60px] lg:leading-[60px] lg:tracking-[-1.2px]">
        {formatPoints(available)}
      </p>

      <div className="relative mt-4 grid grid-cols-2 gap-2.5 lg:hidden">
        <Link
          href="/wallet/top-up"
          className="inline-flex h-11.5 items-center justify-center gap-1.5 rounded-field bg-tone-amber-accent text-body font-extrabold text-ink transition-[filter] hover:brightness-95"
        >
          <Icon name="plus" size={18} />
          Nạp điểm
        </Link>
        <Link
          href={CREATE_SURVEY_HREF}
          className="inline-flex h-11.5 items-center justify-center rounded-field bg-surface text-body font-extrabold text-primary transition-colors hover:bg-tone-green-bg"
        >
          Tạo khảo sát
        </Link>
      </div>
      <Link
        href={CREATE_SURVEY_HREF}
        data-tour="wallet-create-survey"
        className="relative mt-5 hidden h-12 items-center justify-center rounded-field bg-surface text-body font-extrabold text-primary transition-colors hover:bg-tone-green-bg lg:flex"
      >
        Tạo khảo sát bằng điểm
      </Link>
    </section>
  );
}
