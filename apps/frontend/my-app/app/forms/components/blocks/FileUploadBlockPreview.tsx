"use client";

import type { FileUploadBlock } from "@rescom/schemas";

interface FileUploadBlockPreviewProps {
  block: FileUploadBlock;
}

export function FileUploadBlockPreview({ block }: FileUploadBlockPreviewProps) {
  const allowedExtensions = block.allowedMimeTypes
    .map((mime) => mime.split("/")[1] || mime)
    .join(", ");

  return (
    <div className="w-full mt-2">
      <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl p-6 text-center bg-gray-50/40 dark:bg-gray-800/20 hover:border-gray-300 dark:hover:border-gray-600 transition-colors">
        <div className="w-10 h-10 mx-auto mb-2 text-indigo-500/80 bg-indigo-50 dark:bg-indigo-950/40 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
          Drag & drop your file here, or browse
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
          Supports {allowedExtensions} &bull; Up to {block.maxFileSizeMb} MB
          {block.maxFiles > 1 ? ` (Max ${block.maxFiles} files)` : " (Single file)"}
        </p>
      </div>
    </div>
  );
}
