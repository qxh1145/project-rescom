"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { canGoBackInBrowser } from "@/components/feedback/ErrorActions";
import { ERROR_ACTION_LAYOUT, ErrorScreen, errorActionClassName } from "@/components/feedback/ErrorScreen";
import { StatusRow } from "@/components/feedback/ErrorScreenSlots";
import { ERROR_FALLBACK_PATH } from "@/lib/feedback/error-pages";

/** A same-origin request that bypasses every cache proves the app server is reachable again. */
async function probeConnection(): Promise<boolean> {
  try {
    const response = await fetch(window.location.href, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

/** Figma 18.3 "Mất kết nối" — desktop 63:5262, mobile 63:6029. */
export function OfflineScreen({ returnPath }: { returnPath: string | null }) {
  const [checking, setChecking] = useState(false);
  const [stillOffline, setStillOffline] = useState(false);

  const leave = useCallback(() => {
    // Full navigation: chunks of the previous page may have failed to load while offline.
    // Without `?from=` there is nothing to reload into: go back when the previous entry
    // is a Rescom page, else to Khám phá (reloading /offline would keep the user here).
    if (returnPath) window.location.replace(returnPath);
    else if (canGoBackInBrowser()) window.history.back();
    else window.location.replace(ERROR_FALLBACK_PATH);
  }, [returnPath]);

  // "đang thử lại tự động": the browser fires `online` only on an offline → online
  // transition, so this cannot bounce a user who landed here while the device was online.
  useEffect(() => {
    window.addEventListener("online", leave);
    return () => window.removeEventListener("online", leave);
  }, [leave]);

  async function handleRetry() {
    setChecking(true);
    setStillOffline(false);
    if (await probeConnection()) {
      leave();
      return;
    }
    setChecking(false);
    setStillOffline(true);
  }

  return (
    <ErrorScreen
      pill="Mất kết nối"
      title="Bạn đang ngoại tuyến"
      description="Kiểm tra mạng không dây hoặc dữ liệu di động. Rescom sẽ tự tải lại khi có mạng trở lại."
      mascot="offline"
      extra={
        <StatusRow icon="wifi-off" role="status">
          {stillOffline ? "Vẫn chưa có kết nối · đang thử lại tự động" : "Không có kết nối · đang thử lại tự động"}
        </StatusRow>
      }
      actions={
        <>
          <Button size="lg" loading={checking} loadingLabel="Đang kết nối…" onClick={handleRetry} className={ERROR_ACTION_LAYOUT}>
            Thử kết nối lại
          </Button>
          {/* Desktop has "Về Khám phá" in the top bar; mobile gets it here (ASSUMED (design), not drawn). */}
          <Link href={ERROR_FALLBACK_PATH} className={`${errorActionClassName("secondary")} lg:hidden`}>
            Về Khám phá
          </Link>
        </>
      }
    />
  );
}
