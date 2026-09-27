import Link from "next/link";
import type { ReactNode } from "react";
import { getRewardPricingRange } from "@rescom/schemas";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { PointsChip } from "@/components/layout/app/PointsChip";
import { Icon, type IconName } from "@/components/ui/Icon";

/** Example band shown on the cards: a 5–10 minute survey (Figma "khảo sát 5–10 phút"). */
const EXAMPLE_RANGE = getRewardPricingRange(8);
/** FR-19: Form Builder surveys cost 20% less per response (`calculateEscrowCost`). */
const internalPoints = (points: number) => Math.round(points * 0.8);

interface MethodCardProps {
  /** `data-tour` target for the product tour (canvas 20D.1). */
  tourTarget?: string;
  href: string;
  icon: IconName;
  iconTone: string;
  title: string;
  subtitle: string;
  description: string;
  highlighted?: boolean;
  tags: ReactNode;
}

function MethodCard({ href, icon, iconTone, title, subtitle, description, highlighted = false, tags, tourTarget }: MethodCardProps) {
  return (
    <Link
      href={href}
      data-tour={tourTarget}
      className={[
        "group flex flex-col gap-2.5 rounded-[18px] bg-surface p-4 transition-colors hover:bg-surface-subtle",
        highlighted ? "border-2 border-primary" : "border border-line-strong",
      ].join(" ")}
    >
      <span className="flex items-center gap-3">
        <span className={`flex size-11 shrink-0 items-center justify-center rounded-field ${iconTone}`}>
          <Icon name={icon} size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-extrabold text-ink">{title}</span>
          <span className="block text-caption text-ink-muted">{subtitle}</span>
        </span>
        <Icon name="arrow-right" size={20} className={highlighted ? "text-primary" : "text-ink-strong"} />
      </span>
      <span className="text-body-sm text-ink-strong">{description}</span>
      <span className="flex flex-wrap gap-2">{tags}</span>
    </Link>
  );
}

function Pill({ tone, children }: { tone: "amber" | "green" | "neutral"; children: ReactNode }) {
  const classes = {
    amber: "bg-tone-amber-bg font-bold text-tone-amber-fg",
    green: "bg-tone-green-bg font-bold text-tone-green-fg",
    neutral: "bg-surface-subtle font-semibold text-ink-strong",
  }[tone];
  return <span className={`inline-flex h-7 items-center rounded-full px-2.5 text-[12px] ${classes}`}>{children}</span>;
}

/**
 * `/forms/new` — Figma 9 "Tạo khảo sát · chọn cách tạo" (63:2400, mobile).
 * Desktop not drawn: ASSUMED the same content in a centered column with the
 * two cards side by side.
 */
export function ChooseMethodScreen() {
  return (
    <>
      <MobileBackBar
        title="Tạo khảo sát"
        backHref="/forms"
        backLabel="Quay lại Khảo sát của tôi"
        bordered={false}
        action={<PointsChip variant="mobile" />}
      />
      <div className="mx-auto flex w-full max-w-240 flex-col px-5 pt-5 pb-8 lg:px-6 lg:pt-10">
        <nav aria-label="Vị trí" className="hidden text-caption lg:block">
          <Link href="/forms" className="font-semibold text-primary hover:underline">
            Khảo sát của tôi
          </Link>
          <span className="text-ink-muted"> / Tạo khảo sát</span>
        </nav>
        <h1 className="text-[22px] leading-[27.5px] font-extrabold text-ink lg:mt-1.5 lg:text-[28px] lg:leading-normal lg:tracking-[-0.3px]">
          Bạn muốn tạo khảo sát bằng cách nào?
        </h1>
        <p className="mt-2 text-body-sm text-ink-muted">
          Điểm thưởng mỗi lượt được trả từ số dư của bạn và khoá vào Ký quỹ khi gửi duyệt.
        </p>

        <div data-tour="create-methods" className="mt-5 grid gap-4 lg:mt-8 lg:grid-cols-2 lg:gap-6">
          <MethodCard
            href="/forms/new/google-form"
            icon="file-text"
            iconTone="bg-tone-blue-bg text-tone-blue-fg"
            title="Dùng link Google Forms"
            subtitle="Form có sẵn của bạn"
            description="Dán link form. Rescom tạo mã hoàn thành 6 số để bạn dán vào trang cảm ơn cuối form."
            highlighted
            tags={
              <>
                <Pill tone="amber">
                  {EXAMPLE_RANGE.min}–{EXAMPLE_RANGE.max} điểm/lượt · khảo sát 5–10 phút
                </Pill>
                <Pill tone="neutral">Điểm chờ 48 giờ</Pill>
              </>
            }
          />
          <MethodCard
            href="/forms/new/builder"
            tourTarget="create-method-builder"
            icon="layout-grid"
            iconTone="bg-tone-teal-bg text-tone-teal-fg"
            title="Tạo form trong Rescom"
            subtitle="Kéo-thả câu hỏi, có AI gợi ý"
            description="Người trả lời làm ngay trong app, bạn xem từng câu trả lời và đánh giá chất lượng."
            tags={
              <>
                <Pill tone="green">
                  Rẻ hơn 20% · {internalPoints(EXAMPLE_RANGE.min)}–{internalPoints(EXAMPLE_RANGE.max)} điểm/lượt
                </Pill>
                <Pill tone="neutral">Điểm trả ngay</Pill>
              </>
            }
          />
        </div>

        <p className="mt-4 flex items-start gap-2.5 rounded-control bg-tone-green-bg px-3.5 py-3 text-caption-relaxed text-ink lg:mt-6">
          <Icon name="info" size={18} className="mt-px text-primary" />
          <span>
            Mọi khảo sát được Admin duyệt trước khi hiện trên Khám phá. Nếu bị từ chối, điểm ký quỹ được hoàn đủ.
          </span>
        </p>
      </div>
    </>
  );
}
