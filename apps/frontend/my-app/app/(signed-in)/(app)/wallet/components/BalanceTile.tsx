"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { formatPoints } from "@/lib/wallet/top-up";

export interface BalanceTileProps {
  label: string;
  value: number;
  note: string;
  tooltip: string;
  accent?: boolean;
}

export function BalanceTile({
  label,
  value,
  note,
  tooltip,
  accent = false,
}: BalanceTileProps) {
  const [open, setOpen] = useState(false);

  return (
    <li className="relative flex min-h-[105px] flex-col justify-between rounded-2xl border border-line bg-surface p-3 lg:min-h-[102px] lg:p-3.5 shadow-xs">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-ink-muted lg:text-caption">
          {label}
        </span>
        <div className="relative">
          <button
            type="button"
            aria-label={`Thông tin về ${label}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-full text-ink-muted hover:text-ink focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <Icon name="info" size={14} />
          </button>
          {open && (
            <>
              <div
                className="fixed inset-0 z-20 cursor-default"
                onClick={() => setOpen(false)}
              />
              <div
                role="tooltip"
                className="absolute right-0 top-6 z-30 w-48 rounded-lg border border-line bg-surface p-2.5 text-[11px] leading-relaxed text-ink shadow-md"
              >
                {tooltip}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="my-1">
        <span
          className={`text-[22px] font-extrabold lg:text-[26px] ${
            accent ? "text-tone-amber-fg" : "text-ink"
          }`}
        >
          {formatPoints(value)}
        </span>
      </div>
      <span className="truncate text-[11px] text-ink-muted lg:text-[12px]">
        {note}
      </span>
    </li>
  );
}
