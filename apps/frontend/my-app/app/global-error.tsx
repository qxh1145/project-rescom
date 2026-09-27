"use client"; // Error boundaries must be Client Components

import { ServerErrorScreen } from "@/components/feedback/ServerErrorScreen";
import "./globals.css";

/**
 * Replaces the root layout when it throws (Next production checklist), so it
 * brings its own <html>/<body> and styles. Font falls back to the system stack.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="vi">
      <body>
        <title>Đã có lỗi xảy ra — Rescom</title>
        <ServerErrorScreen digest={error.digest} onRetry={retry} />
      </body>
    </html>
  );
}
