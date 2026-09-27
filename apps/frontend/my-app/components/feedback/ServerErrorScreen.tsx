"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { formatIncidentCode, randomIncidentCode } from "@/lib/feedback/error-pages";
import { ErrorScreen, errorActionClassName } from "./ErrorScreen";
import { IncidentCodeBox } from "./IncidentCodeBox";

const subscribeNever = () => () => {};

interface ServerErrorScreenProps {
  /** `error.digest` from a Next error boundary, when the error came from the server. */
  digest?: string;
  /** Wins over `retryPath`. Default: full navigation to `retryPath`, else a reload. */
  onRetry?: () => void;
  /** Sanitized same-origin path the failure happened on (`/server-error?from=`). */
  retryPath?: string | null;
}

function defaultRetry(retryPath: string | null | undefined): () => void {
  // Full navigation: after an outage the client bundle itself may be stale.
  return retryPath ? () => window.location.replace(retryPath) : () => window.location.reload();
}

/** Figma 18.2 "Lỗi máy chủ (500)" — desktop 63:6177, mobile 63:6216. */
export function ServerErrorScreen({ digest, onRetry, retryPath }: ServerErrorScreenProps) {
  const [fallbackCode] = useState(randomIncidentCode);
  // A random code differs between server and client render: show it only once hydrated.
  const hydrated = useSyncExternalStore(subscribeNever, () => true, () => false);
  const code = formatIncidentCode(digest) ?? (hydrated ? fallbackCode : null);

  return (
    <ErrorScreen
      pill="Lỗi 500"
      title="Rescom đang gặp trục trặc"
      description="Lỗi nằm ở phía máy chủ, không phải do bạn. Câu trả lời đã nộp và điểm của bạn vẫn an toàn."
      mascot="sad"
      extra={<IncidentCodeBox code={code} />}
      actions={
        <>
          <button
            type="button"
            className={errorActionClassName("primary")}
            onClick={onRetry ?? defaultRetry(retryPath)}
          >
            Thử lại
          </button>
          <Link href="/marketplace" className={errorActionClassName("secondary")}>
            Về Khám phá
          </Link>
        </>
      }
    />
  );
}
