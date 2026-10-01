"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { FileAttachmentAnswer, FileUploadBlock } from "@rescom/schemas";
import { FileUploadController, type FileUploadHost, type UploadItem } from "@/lib/participation/file-upload-controller";
import { isFileAttachmentList } from "@/lib/participation/file-upload";

/** What one `file_upload` question card needs (see `FileUploadAnswer`). */
export interface FileUploadControls {
  items: readonly UploadItem[];
  notice: string | null;
  /** Files that count toward `maxFiles` (answered, in flight, or still held by a failed upload). */
  liveCount: number;
  /** A delete is settling: no new file may be chosen yet. */
  deleting: boolean;
  choose(files: readonly File[]): void;
  retry(key: string): void;
  dismiss(key: string): void;
  remove(file: FileAttachmentAnswer): void;
}

function hostOf(
  attemptId: string,
  getAnswer: (blockId: string) => unknown,
  setFiles: FileUploadHost["setFiles"],
): FileUploadHost {
  return {
    attemptId,
    getFiles: (blockId) => {
      const value = getAnswer(blockId);
      return isFileAttachmentList(value) ? value : [];
    },
    setFiles,
  };
}

/**
 * The runner's upload state (`FileUploadController`): survives paging, warns
 * before the tab closes while an upload or delete runs, and on unmount aborts
 * uploads in flight and deletes their server objects.
 */
export function useFileUploads(
  attemptId: string,
  getAnswer: (blockId: string) => unknown,
  setFiles: (block: FileUploadBlock, files: FileAttachmentAnswer[], options?: { immediate?: boolean }) => void,
) {
  const [controller] = useState(() => new FileUploadController(hostOf(attemptId, getAnswer, setFiles)));
  // The controller outlives renders: it always reads the runner's latest callbacks.
  useEffect(() => {
    controller.setHost(hostOf(attemptId, getAnswer, setFiles));
  }, [attemptId, controller, getAnswer, setFiles]);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const anyBusy = snapshot.items.some((item) => item.state !== "failed");

  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);

  // Closing or reloading the tab mid-upload would leave a half-done object behind.
  useEffect(() => {
    if (!anyBusy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [anyBusy]);

  const controlsFor = (block: FileUploadBlock): FileUploadControls => {
    const items = snapshot.items.filter((item) => item.blockId === block.id);
    return {
      items,
      notice: snapshot.notices[block.id] ?? null,
      liveCount: controller.liveCount(block.id),
      deleting: items.some((item) => item.state === "deleting"),
      choose: (files) => controller.choose(block, files),
      retry: (key) => void controller.retry(block, key),
      dismiss: (key) => void controller.dismiss(key),
      remove: (file) => void controller.remove(block, file),
    };
  };

  /** Reads the live state (not the render's snapshot): safe inside stable callbacks. */
  const isBusy = useCallback((blockId: string) => controller.isBusy(blockId), [controller]);

  return { controlsFor, isBusy, anyBusy };
}
