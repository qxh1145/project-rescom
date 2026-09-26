"use client";

import React, { useEffect, useRef, useState } from "react";
import type {
  FileAttachmentAnswer,
  FileUploadBlock,
} from "@rescom/schemas";
import {
  validateFileConstraints,
  formatBytes,
} from "../../../hooks/file-upload-handler.mjs";
import { optionalCsrfMutationFetch } from "../../../forms-api";

interface ActiveFileItem {
  id: string; // client-side session key
  file: File;
  name: string;
  size: number;
  type?: string;
  status: "idle" | "initiating" | "uploading" | "scanning" | "clean" | "error";
  progress: number;
  objectId?: string;
  storageKey?: string;
  error?: string;
}

interface RespondentFileUploadBlockProps {
  block: FileUploadBlock;
  value: FileAttachmentAnswer[] | null;
  onChange: (value: FileAttachmentAnswer[]) => void;
  error?: string;
  disabled?: boolean;
  attemptId?: string;
}

function uploadWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (percentage: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    Object.entries(headers).forEach(([name, value]) =>
      request.setRequestHeader(name, value),
    );
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 70) + 15);
      }
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Direct storage upload failed (status ${request.status})`));
    };
    request.onerror = () => reject(new Error("Direct storage upload failed"));
    request.send(file);
  });
}

function itemsFromValue(
  value: FileAttachmentAnswer[] | null | undefined,
): ActiveFileItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => v && typeof v === "object")
    .map((v, i) => ({
      id: v.objectId || `${v.fileName}-${i}`,
      file: new File([], v.fileName),
      name: v.fileName,
      size: v.fileSize,
      type: v.mimeType,
      status: v.status === "CLEAN" ? "clean" : "error",
      progress: 100,
      objectId: v.objectId,
      error: v.status !== "CLEAN" ? "File was not verified clean" : undefined,
    }));
}

function generateClientSessionId(fileName: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${fileName}-${crypto.randomUUID()}`;
  }
  return `${fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function RespondentFileUploadBlock({
  block,
  value,
  onChange,
  error,
  disabled,
  attemptId,
}: RespondentFileUploadBlockProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // Initialize items from current value if already attached
  const [items, setItems] = useState<ActiveFileItem[]>(() =>
    itemsFromValue(value),
  );
  const itemsRef = useRef(items);

  // Epic 5 review P26: an offline draft can be restored after mount; adopt it
  // while nothing is attached locally (never overwrite in-flight uploads).
  useEffect(() => {
    if (itemsRef.current.length > 0) return;
    const restored = itemsFromValue(value);
    if (restored.length === 0) return;
    itemsRef.current = restored;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(restored);
  }, [value]);

  function updateItems(
    updater: (current: ActiveFileItem[]) => ActiveFileItem[],
    notify = false,
  ) {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
    if (notify) notifyParent(next);
  }

  function capabilityHeaders(): Record<string, string> {
    if (!attemptId || typeof window === "undefined") return {};
    const capability = window.sessionStorage.getItem(
      `rescom_storage_capability_${attemptId}`,
    );
    return capability ? { "x-storage-capability": capability } : {};
  }

  const isUploadingAny = items.some(
    (item) =>
      item.status === "initiating" ||
      item.status === "uploading" ||
      item.status === "scanning",
  );

  async function uploadFilePipeline(item: ActiveFileItem) {
    try {
      if (!attemptId) {
        throw new Error("A valid survey attempt is required before uploading files.");
      }
      // Step 1: Initiate Presigned Upload Session (POST /api/storage/uploads/initiate)
      updateItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "initiating", progress: 15 } : i,
        ),
      );

      // AD-20 (Epic 5 review P12): X-CSRF-Token when signed in; guests rely
      // on the same-origin Origin header.
      const initiateRes = await optionalCsrfMutationFetch("/api/storage/uploads/initiate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...capabilityHeaders(),
        },
        body: JSON.stringify({
          fileName: item.name,
          fileSize: item.size,
          mimeType: item.type || "application/octet-stream",
          ownerContext: "participation",
          ownerRecordId: attemptId,
          questionId: block.id,
        }),
      });

      if (!initiateRes.ok) {
        const errorData = await initiateRes.json().catch(() => ({}));
        throw new Error(
          errorData?.error?.message ||
            `Initiate upload failed (status ${initiateRes.status})`,
        );
      }

      const { data: initData } = await initiateRes.json();
      const objectId = initData.objectId;
      const uploadUrl = initData.uploadUrl;
      const storageKey = initData.storageKey;
      const signedHeaders = initData.headers || {};

      // Step 2: Direct Scoped Upload (PUT)
      updateItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "uploading", progress: 45, objectId, storageKey }
            : i,
        ),
      );

      await uploadWithProgress(
        uploadUrl,
        item.file,
        {
          "Content-Type": item.type || "application/octet-stream",
          ...signedHeaders,
        },
        (progress) =>
          updateItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, progress } : i)),
          ),
      );

      // Step 3: Finalize & Malware Scan (POST /api/storage/uploads/:id/finalize)
      updateItems((prev) =>
        prev.map((i) =>
          i.id === item.id ? { ...i, status: "scanning", progress: 85 } : i,
        ),
      );

      const finalizeRes = await optionalCsrfMutationFetch(
        `/api/storage/uploads/${objectId}/finalize`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...capabilityHeaders(),
          },
          body: JSON.stringify({}),
        },
      );

      if (!finalizeRes.ok) {
        const errorData = await finalizeRes.json().catch(() => ({}));
        const code = errorData?.error?.code;
        if (code === "STORAGE_SCANNER_OUTAGE" || finalizeRes.status === 503) {
          throw new Error(
            "Malware scanner outage. File quarantined and fails closed per security policy.",
          );
        }
        throw new Error(
          errorData?.error?.message ||
            `Finalization scan failed (status ${finalizeRes.status})`,
        );
      }

      const { data: finalizeData } = await finalizeRes.json();

      if (finalizeData.status === "REJECTED") {
        throw new Error(
          "Security alert: Malicious content detected. File rejected.",
        );
      }

      if (finalizeData.status !== "CLEAN") {
        throw new Error(
          `Object quarantined with status: ${finalizeData.status}`,
        );
      }

      // Step 4: Verified Clean
      const updatedCleanItem: ActiveFileItem = {
        ...item,
        status: "clean",
        progress: 100,
        objectId,
        storageKey,
      };

      updateItems(
        (prev) => prev.map((i) => (i.id === item.id ? updatedCleanItem : i)),
        true,
      );
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Upload failed";
      updateItems(
        (prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  status: "error" as const,
                  progress: 0,
                  error: errorMessage,
                }
              : i,
          ),
        true,
      );
    }
  }

  function notifyParent(fileList: ActiveFileItem[]) {
    const cleanAnswers: FileAttachmentAnswer[] = fileList
      .filter((i) => i.status === "clean" && i.objectId)
      .map((i) => ({
        objectId: i.objectId!,
        fileName: i.name,
        fileSize: i.size,
        mimeType: i.type || "application/octet-stream",
        status: "CLEAN",
      }));
    onChange(cleanAnswers);
  }

  function handleFileSelection(files: FileList | File[]) {
    setLocalError(null);
    const incoming = Array.from(files);

    const currentItems = itemsRef.current;
    if (currentItems.length + incoming.length > block.maxFiles) {
      setLocalError(`You may upload at most ${block.maxFiles} files.`);
      return;
    }

    const newItems: ActiveFileItem[] = [];

    for (const file of incoming) {
      const validation = validateFileConstraints(file, block);
      if (!validation.valid) {
        setLocalError(validation.error || "Invalid file selected.");
        return;
      }

      const activeItem: ActiveFileItem = {
        id: generateClientSessionId(file.name),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: "idle",
        progress: 0,
      };

      newItems.push(activeItem);
    }

    const updated = [...currentItems, ...newItems];
    itemsRef.current = updated;
    setItems(updated);

    // Launch upload pipeline for each incoming file
    for (const item of newItems) {
      uploadFilePipeline(item);
    }
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setIsDragOver(false);
    if (!disabled && !isUploadingAny && event.dataTransfer.files.length > 0) {
      handleFileSelection(event.dataTransfer.files);
    }
  }

  async function handleRemove(id: string) {
    const target = itemsRef.current.find((item) => item.id === id);
    updateItems((prev) => prev.filter((i) => i.id !== id), true);
    if (target?.objectId) {
      await optionalCsrfMutationFetch(`/api/storage/objects/${target.objectId}`, {
        method: "DELETE",
        headers: capabilityHeaders(),
      }).catch(() => undefined);
    }
  }

  async function handleRetry(file: ActiveFileItem) {
    if (file.objectId) {
      await optionalCsrfMutationFetch(`/api/storage/objects/${file.objectId}`, {
        method: "DELETE",
        headers: capabilityHeaders(),
      }).catch(() => undefined);
    }
    await uploadFilePipeline({
      ...file,
      objectId: undefined,
      storageKey: undefined,
      error: undefined,
      status: "idle",
      progress: 0,
    });
  }

  return (
    <div className="w-full space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        multiple={block.maxFiles > 1}
        disabled={disabled || isUploadingAny}
        accept={block.allowedMimeTypes?.join(",")}
        onChange={(event) => {
          if (event.target.files?.length) {
            handleFileSelection(event.target.files);
          }
          event.target.value = "";
        }}
        className="hidden"
      />

      {/* Selected/Uploaded Files List */}
      {items.map((file) => (
        <div
          key={file.id}
          className={`p-3.5 rounded-xl border transition-all ${
            file.status === "clean"
              ? "bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60"
              : file.status === "error"
                ? "bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800/60"
                : "bg-gray-50 dark:bg-gray-800/80 border-gray-200 dark:border-gray-700"
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-base">
                  {file.status === "clean"
                    ? "📄"
                    : file.status === "error"
                      ? "⚠️"
                      : "⏳"}
                </span>
                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                  {file.name}
                </p>
                <span className="text-xs text-gray-500 shrink-0">
                  ({formatBytes(file.size)})
                </span>
              </div>

              {/* Status Badges */}
              <div className="mt-1.5 flex items-center gap-2">
                {file.status === "clean" && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-100/70 dark:bg-emerald-900/40 px-2 py-0.5 rounded-full">
                    <span>✓</span> Verified Clean & Safe
                  </span>
                )}

                {file.status === "scanning" && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-900/40 px-2 py-0.5 rounded-full animate-pulse">
                    <span>🔍</span> Scanning for malware...
                  </span>
                )}

                {(file.status === "uploading" ||
                  file.status === "initiating") && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-400 bg-blue-100/70 dark:bg-blue-900/40 px-2 py-0.5 rounded-full">
                    <span>☁️</span> Uploading directly to private storage...
                  </span>
                )}

                {file.status === "error" && (
                  <span className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    {file.error || "Upload failed"}
                  </span>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1">
              {file.status === "error" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void handleRetry(file)}
                  className="px-2.5 py-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer"
                >
                  Retry
                </button>
              )}

              <button
                type="button"
                disabled={disabled || file.status === "uploading"}
                onClick={() => handleRemove(file.id)}
                className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                title={`Remove ${file.name}`}
              >
                &times;
              </button>
            </div>
          </div>

          {/* Progress bar during upload */}
          {(file.status === "uploading" ||
            file.status === "initiating" ||
            file.status === "scanning") && (
            <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full mt-2.5 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  file.status === "scanning"
                    ? "bg-amber-500"
                    : "bg-indigo-600"
                }`}
                style={{ width: `${file.progress}%` }}
              />
            </div>
          )}
        </div>
      ))}

      {/* Upload Drop Zone */}
      {items.length < block.maxFiles && (
        <div
          onClick={() =>
            !disabled && !isUploadingAny && fileInputRef.current?.click()
          }
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled && !isUploadingAny) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl transition-colors ${
            isDragOver
              ? "border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30"
              : error || localError
                ? "border-red-300 dark:border-red-800 bg-red-50/20"
                : "border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/40"
          } ${disabled || isUploadingAny ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
        >
          <div className="w-10 h-10 mb-2 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-lg">
            ☁️
          </div>
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            {isUploadingAny
              ? "Uploading in progress..."
              : "Click to upload or drag and drop"}
          </p>
          <p className="text-[11px] text-gray-400 mt-1">
            {items.length}/{block.maxFiles} files • Max {block.maxFileSizeMb}MB
            each
          </p>
          {(block.allowedMimeTypes?.length ?? 0) > 0 && (
            <p className="text-[10px] text-gray-400/80 mt-0.5">
              Allowed formats: {block.allowedMimeTypes?.join(", ")}
            </p>
          )}
        </div>
      )}

      {/* Security notice (AD-22) */}
      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 px-1">
        <span>🛡️</span>
        <span>
          Files are verified with automated malware scanning before attachment
          (AD-22).
        </span>
      </div>

      {/* Error message */}
      {(error || localError) && (
        <p className="text-xs text-red-500 dark:text-red-400 font-medium px-1">
          {error || localError}
        </p>
      )}
    </div>
  );
}
