"use client";

import React from "react";

export type ViewportMode = "desktop" | "tablet" | "mobile";

interface PreviewControlBarProps {
  viewport: ViewportMode;
  onViewportChange: (mode: ViewportMode) => void;
  onExitPreview: () => void;
  onResetAnswers?: () => void;
}

export function PreviewControlBar({
  viewport,
  onViewportChange,
  onExitPreview,
  onResetAnswers,
}: PreviewControlBarProps) {
  return (
    <div className="sticky top-0 z-40 bg-gray-900 text-white px-6 py-3 border-b border-gray-800 shadow-lg">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
        {/* Left: Preview Status Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>Live Form Preview</span>
          </div>
          <span className="hidden md:inline text-xs text-gray-400">
            Previewing as respondent • No answers are saved to database
          </span>
        </div>

        {/* Center: Responsive Viewport Switcher */}
        <div className="flex items-center bg-gray-800 p-1 rounded-xl border border-gray-700">
          <button
            type="button"
            title="Desktop View (100%)"
            onClick={() => onViewportChange("desktop")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              viewport === "desktop"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="hidden sm:inline">Desktop</span>
          </button>

          <button
            type="button"
            title="Tablet View (640px)"
            onClick={() => onViewportChange("tablet")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              viewport === "tablet"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="hidden sm:inline">Tablet</span>
          </button>

          <button
            type="button"
            title="Mobile View (380px)"
            onClick={() => onViewportChange("mobile")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
              viewport === "mobile"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-gray-400 hover:text-white"
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <span className="hidden sm:inline">Mobile</span>
          </button>
        </div>

        {/* Right: Reset & Exit Actions */}
        <div className="flex items-center gap-2">
          {onResetAnswers && (
            <button
              type="button"
              onClick={onResetAnswers}
              className="text-xs text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Reset
            </button>
          )}

          <button
            type="button"
            onClick={onExitPreview}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-xs font-medium border border-gray-700 transition-colors cursor-pointer"
          >
            <span>&times;</span>
            <span>Exit Preview</span>
          </button>
        </div>
      </div>
    </div>
  );
}
