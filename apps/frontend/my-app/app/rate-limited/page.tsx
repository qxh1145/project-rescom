import type { Metadata } from "next";
import {
  firstParam,
  parseRateLimitReason,
  parseRetryAfterSeconds,
  resolveReturnPath,
} from "@/lib/feedback/error-pages";
import { RateLimitedScreen } from "./components/RateLimitedScreen";

interface RateLimitedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ searchParams }: RateLimitedPageProps): Promise<Metadata> {
  const reason = parseRateLimitReason(firstParam((await searchParams).reason));
  return { title: reason === "session" ? "Quá nhiều yêu cầu — Rescom" : "Tạm dừng nhận khảo sát — Rescom" };
}

/**
 * `?retryAfter=<seconds>` (default 60; Figma's 18:24 is sample data), an
 * optional `?from=<same-origin path>` for "Thử lại", and `?reason=session`
 * when the session check was throttled (neutral copy instead of Figma 18.4).
 */
export default async function RateLimitedPage({ searchParams }: RateLimitedPageProps) {
  const params = await searchParams;
  return (
    <RateLimitedScreen
      reason={parseRateLimitReason(firstParam(params.reason))}
      retryAfterSeconds={parseRetryAfterSeconds(firstParam(params.retryAfter))}
      retryPath={resolveReturnPath(firstParam(params.from)) ?? "/marketplace"}
    />
  );
}
