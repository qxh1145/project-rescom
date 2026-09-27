import type { Metadata } from "next";
import { firstParam, resolveReturnPath } from "@/lib/feedback/error-pages";
import { OfflineScreen } from "./components/OfflineScreen";

export const metadata: Metadata = {
  title: "Mất kết nối — Rescom",
};

interface OfflinePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** `?from=<same-origin path>` is where the user returns once the connection is back. */
export default async function OfflinePage({ searchParams }: OfflinePageProps) {
  const returnPath = resolveReturnPath(firstParam((await searchParams).from));
  return <OfflineScreen returnPath={returnPath} />;
}
