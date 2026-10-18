import type { ReactNode } from "react";

interface PayosLogoProps {
  /** Size in pixels (default 16). */
  size?: number;
  className?: string;
  fallback?: ReactNode;
}

/**
 * Official PayOS logo (Story 13.13, AC 7, UX-DR-P15).
 *
 * Local asset in `public/brand/payos/payos-logo.svg`.
 * Owner supplies the official file in Part B (Decision D4).
 * Until official file exists, component renders fallback (or null).
 */
export const PAYOS_LOGO_AVAILABLE = false;

export function PayosLogo({ size = 16, className = "", fallback = null }: PayosLogoProps) {
  if (!PAYOS_LOGO_AVAILABLE) {
    return fallback ? <>{fallback}</> : null;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand artwork
    <img
      src="/brand/payos/payos-logo.svg"
      alt="PayOS"
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}
