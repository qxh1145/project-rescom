"use client";

import { useMemo } from "react";
import { qrModules } from "@/lib/rewards/my-vouchers";

/** Inner width of the 226 px frame (1 px border each side). */
const FRAME_INNER_PX = 224;

/**
 * White 226 px frame; the quiet zone is inside the matrix (4 modules), and each module
 * is a whole number of pixels so crispEdges never renders uneven modules. The code is
 * drawn as one SVG path, never as HTML.
 */
export function VoucherQr({ code, dimmed = false }: { code: string; dimmed?: boolean }) {
  const { size, path } = useMemo(() => qrModules(code), [code]);
  const px = size * Math.max(1, Math.floor(FRAME_INNER_PX / size));
  return (
    <div className={`mx-auto flex size-[226px] items-center justify-center rounded-[16px] border border-line bg-white ${dimmed ? "opacity-40" : ""}`}>
      <svg role={dimmed ? undefined : "img"} aria-label={dimmed ? undefined : "Mã QR của voucher"} aria-hidden={dimmed || undefined} viewBox={`0 0 ${size} ${size}`} width={px} height={px} shapeRendering="crispEdges" className="text-ink">
        <path d={path} fill="currentColor" />
      </svg>
    </div>
  );
}
