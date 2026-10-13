"use client"; // Error boundaries must be Client Components

import { ServerErrorScreen } from "@/components/feedback/ServerErrorScreen";

/** Runtime error boundary for every route below the root layout: Figma 18.2 (500). */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <>
      <title>Đã có lỗi xảy ra: Rescom</title>
      <ServerErrorScreen digest={error.digest} onRetry={retry} />
    </>
  );
}
