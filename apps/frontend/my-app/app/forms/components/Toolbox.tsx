"use client";

import React from "react";
import { BLOCK_CATALOG, BlockTypeMetadata, FormBlockType } from "./block-definitions";

interface ToolboxProps {
  onAddBlock: (type: FormBlockType) => void;
}

export function Toolbox({ onAddBlock }: ToolboxProps) {
  function handleDragStart(e: React.DragEvent, type: FormBlockType) {
    e.dataTransfer.setData("application/rescom-block-type", type);
    e.dataTransfer.effectAllowed = "copy";
  }

  // Render SVG icons according to icon type
  function renderIcon(icon: string) {
    switch (icon) {
      case "text":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h10M4 18h7" />
          </svg>
        );
      case "textarea":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h10" />
          </svg>
        );
      case "number":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
          </svg>
        );
      case "radio":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" strokeWidth="2" />
            <circle cx="12" cy="12" r="4" fill="currentColor" />
          </svg>
        );
      case "checkbox":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="3" width="18" height="18" rx="3" strokeWidth="2" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4" />
          </svg>
        );
      case "star":
        return (
          <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        );
      case "scale":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6h18M3 12h18M3 18h18" />
            <circle cx="6" cy="6" r="2" fill="currentColor" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
            <circle cx="18" cy="18" r="2" fill="currentColor" />
          </svg>
        );
      case "calendar":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="18" rx="2" strokeWidth="2" />
            <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2" />
            <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2" />
            <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2" />
          </svg>
        );
      case "upload":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        );
      default:
        return null;
    }
  }

  return (
    <aside className="w-full bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-bold text-gray-900 dark:text-white">
            Question Toolbox
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Drag onto canvas or click to add
          </p>
        </div>
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
          9 Types
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
        {BLOCK_CATALOG.map((item: BlockTypeMetadata) => (
          <button
            key={item.type}
            type="button"
            draggable
            onDragStart={(e) => handleDragStart(e, item.type)}
            onClick={() => onAddBlock(item.type)}
            className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40 hover:bg-indigo-50/60 dark:hover:bg-indigo-950/40 hover:border-indigo-300 dark:hover:border-indigo-700 text-left transition-all duration-150 cursor-grab active:cursor-grabbing group"
          >
            <div className="w-8 h-8 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 group-hover:text-indigo-600 group-hover:border-indigo-300 transition-colors shrink-0">
              {renderIcon(item.icon)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-gray-800 dark:text-gray-200 group-hover:text-indigo-600 transition-colors">
                {item.label}
              </div>
              <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate">
                {item.description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
