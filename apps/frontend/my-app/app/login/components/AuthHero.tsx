import Image from "next/image";
import { Mascot } from "@/components/brand/Mascot";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { Chip, type ChipTone } from "@/components/ui/Chip";

const ONBOARDING_STEPS: ReadonlyArray<{ label: string; tone: ChipTone }> = [
  { label: "1 · Hoàn tất hồ sơ", tone: "green" },
  { label: "2 · Làm 1 khảo sát, mở khoá 100 điểm", tone: "teal" },
  { label: "3 · Phát hành khảo sát của bạn", tone: "amber" },
];

const LOGIN_DESCRIPTION =
  "Nền tảng trao đổi khảo sát học thuật giữa sinh viên. Làm khảo sát để nhận điểm, dùng điểm để có người trả lời khảo sát của bạn.";

interface AuthHeroProps {
  /** Register (`63:3410`) has its own line; the other auth screens reuse login's. */
  description?: string;
  /** The three onboarding chips appear on the login frame only (not on `63:3406`). */
  showSteps?: boolean;
}

/**
 * Desktop left panel — Figma `62:107` (login) / `63:3406` (register). The illustration overlaps the last
 * chip row like the 900px-tall frame (40px here vs 38.4px in Figma, so
 * fractional line heights can't push the panel past 100vh); on taller screens it
 * stays anchored to the bottom, on shorter ones the panel grows instead of
 * letting text run over the mascot.
 */
export function AuthHero({ description = LOGIN_DESCRIPTION, showSteps = true }: AuthHeroProps) {
  return (
    <section
      aria-labelledby="auth-hero-title"
      className="hidden min-h-screen flex-col overflow-hidden bg-surface-hero lg:flex"
    >
      <div className="relative z-10 px-18 pt-14">
        <RescomLogo size="lg" highPriority />
        <h1 id="auth-hero-title" className="mt-16 max-w-[576px] text-display font-extrabold text-ink">
          Nhận hỗ trợ —<br />
          <span className="text-primary">Đóng góp lại</span>
        </h1>
        <p className="mt-7 max-w-[460px] text-body-lg text-ink-muted">{description}</p>
        {showSteps ? (
          <ol aria-label="Các bước bắt đầu" className="mt-7 flex flex-wrap gap-3">
            {ONBOARDING_STEPS.map((step) => (
              <li key={step.label}>
                <Chip tone={step.tone}>{step.label}</Chip>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <div className="flex-1" />
      <div aria-hidden="true" className="relative -mt-10 h-110 shrink-0">
        <Image
          src="/brand/hills-desktop.jpg"
          alt=""
          fill
          fetchPriority="high"
          sizes="50vw"
          className="object-cover"
        />
        <Mascot name="wave" height={230} className="absolute left-1/2 top-28.5 -translate-x-1/2" />
      </div>
    </section>
  );
}
