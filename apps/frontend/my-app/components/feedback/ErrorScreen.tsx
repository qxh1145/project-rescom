import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mascot, type MascotName } from "@/components/brand/Mascot";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { buttonClassName, type ButtonVariant } from "@/components/ui/Button";
import { Tag, type TagTone } from "@/components/ui/Tag";

/**
 * Buttons on page 18 are 52px, 12px radius, 24px padding; full width and
 * stacked on mobile, inline on desktop.
 */
export const ERROR_ACTION_LAYOUT = "w-full rounded-field! px-6! lg:w-auto";

export function errorActionClassName(variant: ButtonVariant = "primary"): string {
  return buttonClassName({ variant, size: "lg", className: ERROR_ACTION_LAYOUT });
}

interface ErrorScreenProps {
  /** Status pill ("Lỗi 404", "Mất kết nối"…) — text, so the state is never conveyed by color alone. */
  pill: string;
  pillTone?: TagTone;
  title: ReactNode;
  description: ReactNode;
  mascot: MascotName;
  /** Buttons/links styled with `errorActionClassName()`; primary first. */
  actions: ReactNode;
  /** Optional block between the description and the actions (incident code, status row, timer, survey card). */
  extra?: ReactNode;
}

function MascotCircle({ name, circle, height, offsetTop }: { name: MascotName; circle: number; height: number; offsetTop: number }) {
  return (
    <div className="relative shrink-0 rounded-full bg-tone-green-bg" style={{ width: circle, height: circle }}>
      <span className="absolute left-1/2 flex -translate-x-1/2" style={{ top: -offsetTop }}>
        <Mascot name={name} height={height} />
      </span>
    </div>
  );
}

/**
 * Shared layout of Figma page 18 "Trang lỗi hệ thống (có mascot)".
 * Desktop (63:5152): 72px top bar, text column (520px) left, 380px circle with
 * a 400px mascot right, hills band (1440×300, 60%) at the bottom.
 * Mobile (63:5232): logo, mascot in a 200px circle, centered copy, stacked
 * full-width actions pinned to the bottom.
 */
export function ErrorScreen({ pill, pillTone = "neutral", title, description, mascot, actions, extra }: ErrorScreenProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="flex items-center px-6 pt-14 lg:h-18 lg:px-12 lg:pt-0">
        <span className="lg:hidden">
          <RescomLogo size="sm" />
        </span>
        <span className="hidden lg:block">
          <RescomLogo size="md" />
        </span>
        <Link
          href="/marketplace"
          className="ml-auto hidden rounded-sm text-body font-bold text-primary hover:underline lg:block"
        >
          Về Khám phá
        </Link>
      </header>

      <main className="relative flex flex-1 flex-col lg:overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-75 opacity-60 lg:block">
          <Image src="/brand/hills-desktop.jpg" alt="" fill sizes="100vw" className="object-cover" />
        </div>

        {/* Mobile: capped at 440px like the other public screens (ASSUMED for tablets).
            Desktop: 164px above / 284px below the 380px circle = the 828px Figma main. */}
        <div className="relative mx-auto flex w-full max-w-110 flex-1 flex-col px-6 pb-8.5 lg:max-w-360 lg:flex-row lg:items-center lg:justify-between lg:gap-12 lg:pl-24 lg:pr-12 lg:pt-41 lg:pb-71 xl:pr-51.5">
          <div className="flex flex-1 flex-col lg:max-w-130">
            <div className="my-auto flex flex-col items-center pt-6 text-center lg:my-0 lg:items-start lg:pt-0 lg:text-left">
              <div className="mb-5 lg:hidden">
                <MascotCircle name={mascot} circle={200} height={210} offsetTop={4} />
              </div>
              <Tag
                tone={pillTone}
                size="md"
                className={`tracking-[0.3px] lg:tracking-normal ${pillTone === "neutral" ? "text-ink-strong!" : ""}`}
              >
                {pill}
              </Tag>
              <h1 className="mt-3.25 text-title font-extrabold leading-[32.5px] text-ink lg:mt-4.25 lg:text-[46px] lg:leading-[51.5px] lg:tracking-[-1.4px]">
                {title}
              </h1>
              <p className="mt-3.5 text-body leading-[23.3px] text-ink-strong lg:mt-4.5 lg:text-body-lg lg:leading-[28.8px]">
                {description}
              </p>
              {extra ? <div className="mt-3.5 w-full lg:mt-4.75">{extra}</div> : null}
            </div>
            <div className="mt-6 flex flex-col gap-2.5 lg:flex-row lg:gap-3">{actions}</div>
          </div>

          <div className="hidden lg:block">
            <MascotCircle name={mascot} circle={380} height={400} offsetTop={10} />
          </div>
        </div>
      </main>
    </div>
  );
}
