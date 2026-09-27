"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { ButtonVariant } from "@/components/ui/Button";
import { ERROR_FALLBACK_PATH, canGoBackWithinSite } from "@/lib/feedback/error-pages";
import { errorActionClassName } from "./ErrorScreen";

interface ActionProps {
  variant?: ButtonVariant;
  children: ReactNode;
}

/** Browser wrapper of `canGoBackWithinSite` (click handlers only — reads `window`). */
export function canGoBackInBrowser(): boolean {
  const navigation = (window as Window & { navigation?: { canGoBack?: unknown } }).navigation;
  return canGoBackWithinSite({
    navigationCanGoBack: typeof navigation?.canGoBack === "boolean" ? navigation.canGoBack : undefined,
    referrer: document.referrer,
    origin: window.location.origin,
    historyLength: window.history.length,
  });
}

/**
 * "Quay lại trang trước": history back when the previous entry is a Rescom
 * page, otherwise Khám phá — never back to another site (search engine, email…).
 */
export function HistoryBackButton({ variant = "secondary", children }: ActionProps) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={errorActionClassName(variant)}
      onClick={() => (canGoBackInBrowser() ? router.back() : router.push(ERROR_FALLBACK_PATH))}
    >
      {children}
    </button>
  );
}

/** Full reload — after an outage the client bundle itself may be stale. */
export function ReloadButton({ variant = "primary", children }: ActionProps) {
  return (
    <button type="button" className={errorActionClassName(variant)} onClick={() => window.location.reload()}>
      {children}
    </button>
  );
}
