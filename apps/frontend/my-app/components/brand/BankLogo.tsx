"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { getBankInfoByBin, getBankLogoSrc } from "@/lib/brand/bank-logos";

interface BankLogoProps {
  /** NAPAS BIN, e.g. "970436". */
  bankId?: string | null;
  /** Display bank name, e.g. "Vietcombank". */
  bankName?: string | null;
  /** Rendered size in pixels (default 16). */
  size?: number;
  className?: string;
}

/**
 * Bank logo component (Story 13.13, AC 7, UX-DR-P15).
 *
 * Maps NAPAS BIN to `/brand/banks/{code}.png`.
 * Unknown, missing BIN or unsupplied asset falls back to generic `<Icon name="bank" />`.
 */
export function BankLogo({ bankId, bankName, size = 16, className = "" }: BankLogoProps) {
  const info = getBankInfoByBin(bankId);
  const src = getBankLogoSrc(bankId);
  const alt = bankName || info?.name || "Ngân hàng";
  // A listed asset that fails to load (missing deploy, 404) falls back to the icon too.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return <Icon name="bank" size={size} className={className} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand bank asset
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`}
      onError={() => setFailedSrc(src)}
    />
  );
}
