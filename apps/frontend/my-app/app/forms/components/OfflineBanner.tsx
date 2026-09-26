"use client";

import React, { useState } from "react";

interface OfflineBannerProps {
  isOnline: boolean;
  wasOffline?: boolean;
  isRestored?: boolean;
}

export function OfflineBanner({
  isOnline,
  wasOffline = false,
  isRestored = false,
}: OfflineBannerProps) {
  const [dismissRestored, setDismissRestored] = useState(false);

  if (!isOnline) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="w-full bg-amber-500/15 border border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-3 rounded-2xl flex items-center gap-3 text-xs sm:text-sm animate-in fade-in transition-all mb-4"
      >
        <span className="text-base sm:text-lg shrink-0">⚠️</span>
        <div className="flex-1">
          <p className="font-semibold">You are currently offline</p>
          <p className="text-amber-800/80 dark:text-amber-300/80 text-xs mt-0.5">
            Your responses are cached safely on this device. You can keep answering questions; they will be submitted once your connection is restored.
          </p>
        </div>
        <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
      </div>
    );
  }

  if (wasOffline) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="w-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-900 dark:text-emerald-200 px-4 py-2.5 rounded-2xl flex items-center justify-between gap-3 text-xs sm:text-sm animate-in fade-in transition-all mb-4"
      >
        <div className="flex items-center gap-2.5">
          <span className="text-base shrink-0">🟢</span>
          <p className="font-medium">
            <strong>Back online!</strong> Your connection has been restored.
          </p>
        </div>
      </div>
    );
  }

  if (isRestored && !dismissRestored) {
    return (
      <div
        role="status"
        className="w-full bg-blue-500/10 border border-blue-500/20 text-blue-900 dark:text-blue-200 px-4 py-2.5 rounded-2xl flex items-center justify-between gap-3 text-xs animate-in fade-in transition-all mb-4"
      >
        <div className="flex items-center gap-2">
          <span>💾</span>
          <span>Restored saved draft responses from your previous session.</span>
        </div>
        <button
          type="button"
          onClick={() => setDismissRestored(true)}
          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 font-bold px-1.5 py-0.5"
          title="Dismiss"
        >
          ✕
        </button>
      </div>
    );
  }

  return null;
}
