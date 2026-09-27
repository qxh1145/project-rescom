import type { Metadata } from "next";
import { firstParam, parseRetryAfterSeconds, resolveReturnPath } from "@/lib/feedback/error-pages";
import { RateLimitedScreen } from "./components/RateLimitedScreen";

export const metadata: Metadata = {
  title: "Tạm dừng nhận khảo sát — Rescom",
};

interface RateLimitedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `?retryAfter=<seconds>` (default 60; Figma's 18:24 is sample data) and an
 * optional `?from=<same-origin path>` for "Thử lại" once the pause is over.
 */
export default async function RateLimitedPage({ searchParams }: RateLimitedPageProps) {
  const params = await searchParams;
  return (
    <RateLimitedScreen
      retryAfterSeconds={parseRetryAfterSeconds(firstParam(params.retryAfter))}
      retryPath={resolveReturnPath(firstParam(params.from)) ?? "/marketplace"}
    />
  );
}
