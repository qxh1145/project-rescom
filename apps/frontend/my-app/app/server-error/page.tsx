import type { Metadata } from "next";
import { ServerErrorScreen } from "@/components/feedback/ServerErrorScreen";
import { firstParam, resolveReturnPath } from "@/lib/feedback/error-pages";

export const metadata: Metadata = {
  title: "Lỗi máy chủ — Rescom",
};

interface ServerErrorPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Target of `SessionGate` when the session check fails with a server error.
 * `?from=<same-origin path>` is where "Thử lại" goes; without it the page reloads.
 */
export default async function ServerErrorPage({ searchParams }: ServerErrorPageProps) {
  const retryPath = resolveReturnPath(firstParam((await searchParams).from));
  return <ServerErrorScreen retryPath={retryPath} />;
}
