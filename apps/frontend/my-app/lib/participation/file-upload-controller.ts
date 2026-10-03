import type { FileAttachmentAnswer, FileUploadBlock } from "@rescom/schemas";
import {
  MAX_OUTAGE_RETRIES,
  UPLOAD_MESSAGES,
  attachmentOf,
  checkFileForQuestion,
  isQuestionFullError,
  isRetryableFinalize,
  isScannerOutage,
  outageExhaustedMessage,
  questionFullMessage,
  uploadErrorMessage,
} from "./file-upload.ts";
import {
  FileUploadError,
  deleteUpload,
  finalizeToAttachment,
  listUploads,
  uploadQuestionFile,
  type UploadStage,
} from "./file-upload-service.ts";

/**
 * Upload state of an in-Rescom attempt (mock-off Phase 7), owned by the
 * runner rather than by a question card, so paging does not lose it.
 * Framework-free (the runner subscribes with `useSyncExternalStore`):
 *
 * - every chosen file runs initiate → PUT → finalize; only CLEAN files reach
 *   the answer (`host.setFiles`);
 * - a failed upload that still holds a server object counts toward
 *   `maxFiles` until it is dismissed (deleted) or retried;
 * - retry / dismiss / remove await the DELETE before anything else, so the
 *   server never holds more objects than the respondent sees; a failed
 *   delete is shown and nothing is dropped;
 * - after a scanner outage only finalize is retried, `MAX_OUTAGE_RETRIES`
 *   times at most;
 * - 409 `STORAGE_QUESTION_FULL` lists the question's live uploads: CLEAN ones
 *   the runner lost (reload) are re-adopted, half-done ones deleted;
 * - `dispose()` (leaving the attempt) aborts uploads in flight and deletes
 *   their objects — after the scan when one was running.
 */

export interface UploadItem {
  key: string;
  blockId: string;
  name: string;
  size: number;
  state: "working" | "failed" | "deleting";
  stage?: UploadStage;
  percent?: number;
  message?: string;
  /** The server object this item holds (counts toward `maxFiles`). */
  objectId: string | null;
  /** Only finalize is retried (the bytes are already stored). */
  retryFinalize?: boolean;
  /** Retry is no longer offered (scanner still down after the retries). */
  retryExhausted?: boolean;
  outageRetries: number;
  file?: File;
}

export interface FileUploadHost {
  attemptId: string;
  /** The question's current answer (CLEAN attachments). */
  getFiles(blockId: string): FileAttachmentAnswer[];
  /** Replace the answer; `immediate` saves the local draft at once. */
  setFiles(block: FileUploadBlock, files: FileAttachmentAnswer[], options?: { immediate?: boolean }): void;
}

export interface FileUploadControllerDeps {
  upload: typeof uploadQuestionFile;
  finalize: (attemptId: string, objectId: string) => Promise<FileAttachmentAnswer>;
  remove: typeof deleteUpload;
  list: typeof listUploads;
}

const DEFAULT_DEPS: FileUploadControllerDeps = {
  upload: (input) => uploadQuestionFile(input),
  finalize: (attemptId, objectId) => finalizeToAttachment(attemptId, objectId),
  remove: deleteUpload,
  list: listUploads,
};

export interface FileUploadSnapshot {
  items: readonly UploadItem[];
  notices: Readonly<Record<string, string | null>>;
}

let sequence = 0;
const nextKey = () => `upload-${++sequence}`;

export class FileUploadController {
  private snapshot: FileUploadSnapshot = { items: [], notices: {} };
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, AbortController>();
  private disposed = false;

  private host: FileUploadHost;
  private readonly deps: FileUploadControllerDeps;

  constructor(host: FileUploadHost, deps: FileUploadControllerDeps = DEFAULT_DEPS) {
    this.host = host;
    this.deps = deps;
  }

  /** The runner's latest answer accessors (they change between renders). */
  setHost(host: FileUploadHost): void {
    this.host = host;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FileUploadSnapshot => this.snapshot;

  itemsOf(blockId: string): UploadItem[] {
    return this.snapshot.items.filter((item) => item.blockId === blockId);
  }

  noticeOf(blockId: string): string | null {
    return this.snapshot.notices[blockId] ?? null;
  }

  /** An upload or a delete of this question is still running. */
  isBusy(blockId: string): boolean {
    return this.itemsOf(blockId).some((item) => item.state !== "failed");
  }

  anyBusy(): boolean {
    return this.snapshot.items.some((item) => item.state !== "failed");
  }

  /** Files that count toward `maxFiles` on the server, as far as this tab knows. */
  liveCount(blockId: string): number {
    return (
      this.host.getFiles(blockId).length +
      this.itemsOf(blockId).filter((item) => item.state !== "failed" || item.objectId !== null).length
    );
  }

  /** Re-enables a controller React re-mounted (StrictMode runs effects twice). */
  activate(): void {
    this.disposed = false;
  }

  /** Leaving the attempt: abort uploads in flight; their objects are deleted when they settle. */
  dispose(): void {
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  choose(block: FileUploadBlock, files: readonly File[]): void {
    this.setNotice(block.id, null);
    let live = this.liveCount(block.id);
    for (const file of files) {
      const problem = checkFileForQuestion(block, { name: file.name, size: file.size, type: file.type }, live);
      if (problem) {
        this.setNotice(block.id, problem);
        return;
      }
      live += 1;
      this.start(block, file);
    }
  }

  async retry(block: FileUploadBlock, key: string): Promise<void> {
    const item = this.find(key);
    if (!item || item.state !== "failed" || item.retryExhausted) return;
    if (item.retryFinalize && item.objectId) {
      const objectId = item.objectId;
      this.update(key, { state: "working", stage: "scanning", percent: 92, message: undefined });
      try {
        this.attach(block, key, await this.deps.finalize(this.host.attemptId, objectId));
      } catch (error) {
        this.fail(block, key, error, item.file);
      }
      return;
    }
    if (!item.file) return;
    if (item.objectId && !(await this.deleteHeld(key, item.objectId))) return;
    this.start(block, item.file, key);
  }

  /** "Bỏ tệp này": deletes the object a failed upload holds, then forgets it. */
  async dismiss(key: string): Promise<void> {
    const item = this.find(key);
    if (!item || item.state !== "failed") return;
    if (item.objectId && !(await this.deleteHeld(key, item.objectId))) return;
    this.drop(key);
  }

  /** Removes an answered file: the server copy is deleted first, then the answer (saved at once). */
  async remove(block: FileUploadBlock, file: FileAttachmentAnswer): Promise<void> {
    const key = `remove-${file.objectId}`;
    if (this.find(key)) return;
    this.setNotice(block.id, null);
    this.add({ key, blockId: block.id, name: file.fileName, size: file.fileSize, state: "deleting", objectId: file.objectId, outageRetries: 0 });
    try {
      await this.deps.remove(this.host.attemptId, file.objectId);
    } catch {
      this.drop(key);
      this.setNotice(block.id, UPLOAD_MESSAGES.deleteFailed);
      return;
    }
    this.drop(key);
    this.host.setFiles(
      block,
      this.host.getFiles(block.id).filter((entry) => entry.objectId !== file.objectId),
      { immediate: true },
    );
  }

  /**
   * After a 409 `STORAGE_QUESTION_FULL`: re-adopts CLEAN uploads of this
   * question the answer lost (reload, crash) and deletes half-done ones
   * nobody tracks. Returns how many of each.
   */
  async reconcile(block: FileUploadBlock): Promise<{ adopted: number; cleaned: number }> {
    const objects = await this.deps.list(this.host.attemptId, block.id);
    const answered = new Set(this.host.getFiles(block.id).map((file) => file.objectId));
    const tracked = new Set(this.itemsOf(block.id).map((item) => item.objectId).filter(Boolean));
    const adopted: FileAttachmentAnswer[] = [];
    let cleaned = 0;
    for (const object of objects) {
      if (answered.has(object.id) || tracked.has(object.id)) continue;
      if (object.status === "CLEAN") {
        if (answered.size + adopted.length < block.maxFiles) adopted.push(attachmentOf(object));
      } else if (object.status !== "ATTACHED") {
        try {
          await this.deps.remove(this.host.attemptId, object.id);
          cleaned += 1;
        } catch {
          // Lapses with its upload window; the notice still tells what to do.
        }
      }
    }
    if (adopted.length > 0) {
      this.host.setFiles(block, [...this.host.getFiles(block.id), ...adopted], { immediate: true });
    }
    return { adopted: adopted.length, cleaned };
  }

  private start(block: FileUploadBlock, file: File, key = nextKey()): void {
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const item: UploadItem = {
      key,
      blockId: block.id,
      name: file.name,
      size: file.size,
      state: "working",
      stage: "initiating",
      percent: 0,
      objectId: null,
      outageRetries: 0,
      file,
    };
    if (this.find(key)) this.replace(key, item);
    else this.add(item);
    this.deps
      .upload({
        attemptId: this.host.attemptId,
        block,
        file,
        signal: controller.signal,
        onProgress: ({ stage, percent, objectId }) =>
          this.update(key, { stage, percent, ...(objectId ? { objectId } : {}) }),
      })
      .then(
        (attachment) => {
          this.controllers.delete(key);
          this.attach(block, key, attachment);
        },
        (error: unknown) => {
          this.controllers.delete(key);
          if (error instanceof FileUploadError && error.aborted) {
            // Left mid-upload: nothing may stay behind on the server.
            if (error.objectId) void this.deps.remove(this.host.attemptId, error.objectId).catch(() => undefined);
            if (!this.disposed) this.drop(key);
            return;
          }
          this.fail(block, key, error, file);
        },
      );
  }

  private attach(block: FileUploadBlock, key: string, attachment: FileAttachmentAnswer): void {
    if (this.disposed) {
      void this.deps.remove(this.host.attemptId, attachment.objectId).catch(() => undefined);
      return;
    }
    this.drop(key);
    this.host.setFiles(block, [...this.host.getFiles(block.id), attachment]);
  }

  private fail(block: FileUploadBlock, key: string, error: unknown, file: File | undefined): void {
    if (this.disposed) return;
    const failure = error instanceof FileUploadError ? error.failure : error;
    const objectId = error instanceof FileUploadError ? error.objectId : (this.find(key)?.objectId ?? null);
    const previous = this.find(key);
    const outageRetries = (previous?.outageRetries ?? 0) + (isScannerOutage(failure) ? 1 : 0);
    const retryFinalize =
      error instanceof FileUploadError && error.stage === "scanning" && objectId !== null && isRetryableFinalize(failure);
    const retryExhausted = retryFinalize && isScannerOutage(failure) && outageRetries > MAX_OUTAGE_RETRIES;
    this.replace(key, {
      key,
      blockId: block.id,
      name: previous?.name ?? file?.name ?? "",
      size: previous?.size ?? file?.size ?? 0,
      state: "failed",
      message: retryExhausted ? outageExhaustedMessage(failure) : uploadErrorMessage(failure),
      objectId,
      retryFinalize,
      retryExhausted,
      outageRetries,
      file,
    });
    if (isQuestionFullError(failure)) void this.recoverFullQuestion(block);
  }

  private async recoverFullQuestion(block: FileUploadBlock): Promise<void> {
    let outcome = { adopted: 0, cleaned: 0 };
    try {
      outcome = await this.reconcile(block);
    } catch {
      // Listing failed: the generic "full" advice stays.
    }
    if (this.disposed) return;
    this.setNotice(
      block.id,
      outcome.adopted > 0
        ? `Đã khôi phục ${outcome.adopted} tệp bạn tải lên trước đó cho câu này.`
        : outcome.cleaned > 0
          ? `Đã dọn ${outcome.cleaned} tệp tải dở trên máy chủ. Hãy bấm “Thử lại”.`
          : questionFullMessage(block.maxFiles),
    );
  }

  /** Deletes the object a failed item holds; on failure the item stays, with the reason. */
  private async deleteHeld(key: string, objectId: string): Promise<boolean> {
    const before = this.find(key);
    this.update(key, { state: "deleting", message: undefined });
    try {
      await this.deps.remove(this.host.attemptId, objectId);
      this.update(key, { objectId: null });
      return true;
    } catch {
      if (before) this.replace(key, { ...before, message: UPLOAD_MESSAGES.deleteFailed });
      return false;
    }
  }

  private find(key: string): UploadItem | undefined {
    return this.snapshot.items.find((item) => item.key === key);
  }

  private add(item: UploadItem): void {
    this.commit({ ...this.snapshot, items: [...this.snapshot.items, item] });
  }

  private replace(key: string, item: UploadItem): void {
    this.commit({ ...this.snapshot, items: this.snapshot.items.map((entry) => (entry.key === key ? item : entry)) });
  }

  private update(key: string, patch: Partial<UploadItem>): void {
    const item = this.find(key);
    if (item) this.replace(key, { ...item, ...patch });
  }

  private drop(key: string): void {
    this.commit({ ...this.snapshot, items: this.snapshot.items.filter((item) => item.key !== key) });
  }

  private setNotice(blockId: string, notice: string | null): void {
    if ((this.snapshot.notices[blockId] ?? null) === notice) return;
    this.commit({ ...this.snapshot, notices: { ...this.snapshot.notices, [blockId]: notice } });
  }

  private commit(next: FileUploadSnapshot): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
