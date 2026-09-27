"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorScreen, errorActionClassName } from "@/components/feedback/ErrorScreen";
import { CountdownPanel } from "@/components/feedback/ErrorScreenSlots";
import { countdownAnnouncement, formatCountdown } from "@/lib/feedback/error-pages";

interface RateLimitedScreenProps {
  retryAfterSeconds: number;
  /** Where "Thử lại" goes once the pause is over. */
  retryPath: string;
}

/** Figma 18.4 "Tạm dừng vì làm quá nhiều" — desktop 63:6102, mobile 63:6141. */
export function RateLimitedScreen({ retryAfterSeconds, retryPath }: RateLimitedScreenProps) {
  const [remaining, setRemaining] = useState(retryAfterSeconds);
  const done = remaining <= 0;

  useEffect(() => {
    // Wall-clock deadline: throttled background tabs do not slow the countdown down.
    const deadline = Date.now() + retryAfterSeconds * 1000;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [retryAfterSeconds]);

  return (
    <ErrorScreen
      pill="Tạm dừng"
      title="Nghỉ tay một chút nhé"
      description="Bạn đã làm rất nhiều khảo sát trong một giờ qua. Để giữ chất lượng câu trả lời, Rescom tạm dừng lượt mới."
      mascot="sleep"
      extra={
        <>
          <CountdownPanel
            label={done ? "Bạn đã có thể nhận khảo sát mới" : "Bạn có thể nhận khảo sát mới sau"}
            time={formatCountdown(remaining)}
          />
          {/* The timer itself is silent; this region speaks once per minute (its text changes only then). */}
          <p aria-live="polite" className="sr-only">
            {countdownAnnouncement(remaining)}
          </p>
        </>
      }
      actions={
        <>
          {done ? (
            // ASSUMED (not drawn): once the pause is over the primary action becomes "Thử lại".
            <Link href={retryPath} className={errorActionClassName("primary")}>
              Thử lại
            </Link>
          ) : (
            <Link href="/wallet" className={errorActionClassName("primary")}>
              Xem Ví điểm
            </Link>
          )}
          <Link href="/marketplace" className={errorActionClassName("secondary")}>
            Về Khám phá
          </Link>
        </>
      }
    />
  );
}
