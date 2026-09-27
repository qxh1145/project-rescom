"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Mascot } from "@/components/brand/Mascot";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { Alert } from "@/components/ui/Alert";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useLogout } from "@/lib/auth/use-logout";
import { OnboardingHeader } from "./OnboardingHeader";

const HOW_IT_WORKS = [
  {
    icon: "file-text",
    tile: "bg-tone-green-bg text-tone-green-fg",
    title: "1. Làm khảo sát hợp với bạn",
    body: "Rescom chỉ gợi ý khảo sát bạn đủ điều kiện tham gia.",
  },
  {
    icon: "points-coin",
    tile: "bg-tone-amber-bg text-tone-amber-fg",
    title: "2. Nhận điểm cho mỗi lượt hợp lệ",
    body: "Khảo sát 5–10 phút thường được 10–20 điểm.",
  },
  {
    icon: "bar-chart",
    tile: "bg-tone-teal-bg text-tone-teal-fg",
    title: "3. Dùng điểm cho nghiên cứu của bạn",
    body: "Đăng khảo sát và trả điểm cho người trả lời.",
  },
] as const;

interface WelcomeScreenProps {
  name: string;
  questionCount: number;
  startHref: string;
  /** `?required=1`: sent here by the post-login redirect or an earning page. */
  required: boolean;
}

/** "12 · Chào mừng" — desktop 63:5069 (hills + mascot left), mobile 63:5185 (hills on top). */
export function WelcomeScreen({ name, questionCount, startHref, required }: WelcomeScreenProps) {
  const duration = `${questionCount} câu ngắn · khoảng 2 phút`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Every signed-in page leads here until the profile is done, so this is the way out (wrong account).
  const { signOut, pending, error, dismissError } = useLogout();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <OnboardingHeader />
      <main className="flex flex-1 flex-col lg:grid lg:grid-cols-2">
        {/* Mobile hero (63:5186): 290px hills, logo, waving mascot. */}
        <div aria-hidden="true" className="relative h-72.5 shrink-0 overflow-hidden lg:hidden">
          <Image src="/brand/hills-mobile.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
          <div className="absolute top-[max(env(safe-area-inset-top),12px)] left-6">
            <RescomLogo size="base" highPriority />
          </div>
          <Mascot name="wave" height={150} className="absolute top-31.5 left-1/2 -translate-x-1/2" />
        </div>

        {/* Desktop hero (63:5072): hills along the bottom, mascot standing on them. */}
        <div aria-hidden="true" className="relative hidden overflow-hidden bg-surface-hero lg:block">
          <div className="absolute inset-x-0 bottom-0 h-105">
            <Image src="/brand/hills-desktop.jpg" alt="" fill priority sizes="50vw" className="object-cover" />
          </div>
          <Mascot name="wave" height={260} className="absolute bottom-27.5 left-1/2 -translate-x-1/2" />
        </div>

        <section className="flex flex-1 flex-col px-6 pt-5 lg:justify-center lg:pt-0 lg:pr-12 lg:pl-24">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-question-sm font-extrabold outline-none text-ink lg:max-w-130 lg:text-[44px] lg:leading-[50.6px] lg:tracking-[-1.3px]"
          >
            Chào {name},<br className="hidden lg:block" />{" "}
            <span className="lg:text-primary">Rescom hoạt động thế này</span>
          </h1>

          {required ? (
            <Alert tone="info" className="mt-4 lg:mt-6 lg:max-w-130">
              Bạn cần hoàn tất hồ sơ này trước khi làm khảo sát có thưởng.
            </Alert>
          ) : null}

          <ul className="mt-4.5 flex flex-col gap-3.5 lg:mt-7 lg:gap-4.5">
            {HOW_IT_WORKS.map((item) => (
              <li key={item.title} className="flex items-start gap-3.5">
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-field lg:size-12 ${item.tile}`}
                >
                  <Icon name={item.icon} size={20} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-button font-bold text-ink">{item.title}</span>
                  <span className="text-body-sm leading-[20.3px] text-ink-muted">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-auto flex flex-col-reverse gap-2.5 pt-8 lg:mt-7 lg:flex-row lg:items-center lg:gap-4 lg:p-0">
            <Link href={startHref} className={buttonClassName({ size: "2xl", fullWidth: true, className: "lg:w-auto lg:px-8" })}>
              <span>
                Bắt đầu
                <Icon name="arrow-right" size={20} className="ml-2 align-[-4px]" />
              </span>
            </Link>
            <p className="text-center text-caption text-ink-muted lg:text-left lg:text-body-sm">
              {duration}
              <span className="lg:hidden"> · sửa được sau</span>
            </p>
          </div>

          <div className="pt-4 pb-[max(env(safe-area-inset-bottom),32px)] lg:pt-6 lg:pb-0">
            {error ? (
              <Alert tone="danger" onDismiss={dismissError} className="mb-3 lg:max-w-130">
                {error}
              </Alert>
            ) : null}
            <p className="text-center text-caption text-ink-muted lg:text-left lg:text-body-sm">
              Không phải {name}?{" "}
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={pending}
                className="font-bold text-ink underline disabled:opacity-60"
              >
                {pending ? "Đang đăng xuất…" : "Đăng xuất"}
              </button>
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
