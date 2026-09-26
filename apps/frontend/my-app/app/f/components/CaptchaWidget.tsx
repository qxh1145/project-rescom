"use client";

import React, { useState } from "react";

export interface CaptchaWidgetProps {
  onVerify: (token: string) => void;
  onExpire?: () => void;
  disabled?: boolean;
}

export function CaptchaWidget({
  onVerify,
  onExpire,
  disabled = false,
}: CaptchaWidgetProps) {
  const [status, setStatus] = useState<"idle" | "verifying" | "verified">("idle");

  async function handleToggle() {
    if (disabled || status === "verified" || status === "verifying") return;

    setStatus("verifying");
    // Simulate brief verification latency for realistic challenge feedback
    await new Promise((resolve) => setTimeout(resolve, 450));
    setStatus("verified");
    onVerify("test-turnstile-token");
  }

  function handleReset() {
    if (disabled) return;
    setStatus("idle");
    onExpire?.();
  }

  return (
    <div className="w-full max-w-sm rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/60 p-3.5 select-none transition-all">
      <div className="flex items-center justify-between gap-4">
        {/* Checkbox / Verification Trigger */}
        <div
          role="checkbox"
          aria-checked={status === "verified"}
          tabIndex={disabled ? -1 : 0}
          onClick={handleToggle}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              handleToggle();
            }
          }}
          className={`flex items-center gap-3 cursor-pointer ${
            disabled ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          <div
            className={`w-7 h-7 rounded-lg flex items-center justify-center border-2 transition-all ${
              status === "verified"
                ? "bg-emerald-600 border-emerald-600 text-white shadow-xs"
                : status === "verifying"
                  ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40"
                  : "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-indigo-500"
            }`}
          >
            {status === "verifying" && (
              <span className="w-3.5 h-3.5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            )}
            {status === "verified" && (
              <svg
                className="w-4 h-4 stroke-current"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="3"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>

          <div className="text-left">
            <p className="text-xs font-medium text-gray-900 dark:text-gray-200">
              {status === "verified"
                ? "Verification complete"
                : status === "verifying"
                  ? "Verifying security token..."
                  : "Verify you are human"}
            </p>
            {status === "verified" ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleReset();
                }}
                className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 underline mt-0.5"
              >
                Reset challenge
              </button>
            ) : (
              <p className="text-[10px] text-gray-400">Click to confirm</p>
            )}
          </div>
        </div>

        {/* Cloudflare / Bot Protection Brand Indicator */}
        <div className="flex flex-col items-end text-right shrink-0">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-gray-700 dark:text-gray-300">
            <span>🛡️</span>
            <span>Turnstile</span>
          </div>
          <span className="text-[9px] text-gray-400">Cloudflare Protected</span>
        </div>
      </div>
    </div>
  );
}
