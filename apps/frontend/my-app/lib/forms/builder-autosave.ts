/**
 * Autosave of the Form Builder draft (`PATCH /forms/:id/draft`, VERIFIED).
 *
 * The backend uses optimistic locking: every PATCH echoes the `updatedAt` of
 * the last successful read/write as `clientUpdatedAt`; a stale value answers
 * 409 `FORM_EDIT_CONFLICT`. The controller therefore runs **one save at a
 * time**, always sends the newest queued payload, chains the returned
 * `updatedAt` into the next request, and stops on a conflict until the
 * screen resolves it (reload or overwrite). Timers are injected for tests.
 */

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "offline" | "error" | "conflict";

export interface AutosaveSnapshot {
  status: AutosaveStatus;
  /** `updatedAt` of the last successful save/read (the next `clientUpdatedAt`). */
  baseline: string | null;
  lastSavedAt: string | null;
  error: unknown;
  /** A payload is waiting (dirty). */
  hasPending: boolean;
}

export interface AutosaveControllerOptions<P> {
  delayMs: number;
  save: (payload: P, clientUpdatedAt: string) => Promise<{ updatedAt: string }>;
  isConflict: (error: unknown) => boolean;
  isOffline: (error: unknown) => boolean;
  onChange?: (snapshot: AutosaveSnapshot) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface AutosaveController<P> {
  queue(payload: P): void;
  /** Saves now (skips the debounce); resolves when nothing is pending or saving stopped. */
  flush(): Promise<void>;
  /** A fresh server read (initial load, "Tải bản mới nhất", overwrite after a conflict). */
  setBaseline(updatedAt: string): void;
  /** Forget the queued payload (e.g. after reloading the server version). */
  discardPending(): void;
  snapshot(): AutosaveSnapshot;
  dispose(): void;
}

export function createAutosaveController<P>(options: AutosaveControllerOptions<P>): AutosaveController<P> {
  const setTimer = options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let state: AutosaveSnapshot = { status: "idle", baseline: null, lastSavedAt: null, error: null, hasPending: false };
  let pending: { payload: P } | null = null;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let disposed = false;

  const emit = (patch: Partial<AutosaveSnapshot>) => {
    state = { ...state, ...patch, hasPending: pending !== null };
    if (!disposed) options.onChange?.(state);
  };

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const drain = async (): Promise<void> => {
    while (pending && !disposed) {
      if (state.status === "conflict") return;
      const baseline = state.baseline;
      if (!baseline) {
        emit({ status: "error", error: new Error("Missing draft version (updatedAt).") });
        return;
      }
      const { payload } = pending;
      pending = null;
      emit({ status: "saving", error: null });
      try {
        const { updatedAt } = await options.save(payload, baseline);
        emit({ status: pending ? "pending" : "saved", baseline: updatedAt, lastSavedAt: updatedAt });
      } catch (error) {
        // Keep the newest edit: a payload queued meanwhile wins over the failed one.
        pending ??= { payload };
        if (options.isConflict(error)) emit({ status: "conflict", error });
        else if (options.isOffline(error)) emit({ status: "offline", error });
        else emit({ status: "error", error });
        return;
      }
    }
  };

  const run = (): Promise<void> => {
    if (running) return running;
    running = drain().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    queue(payload) {
      if (disposed) return;
      pending = { payload };
      if (state.status !== "saving" && state.status !== "conflict") emit({ status: "pending" });
      else emit({});
      cancelTimer();
      timer = setTimer(() => {
        timer = null;
        void run();
      }, options.delayMs);
    },
    async flush() {
      cancelTimer();
      if (running) await running;
      if (pending && state.status !== "conflict") await run();
    },
    setBaseline(updatedAt) {
      emit({ baseline: updatedAt, status: pending ? "pending" : "idle", error: null });
    },
    discardPending() {
      cancelTimer();
      pending = null;
      emit({ status: state.status === "conflict" ? "idle" : state.status });
    },
    snapshot: () => state,
    dispose() {
      cancelTimer();
      disposed = true;
    },
  };
}

/** Status line under the form title ("Bản nháp · đã lưu lúc 21:20"). */
export function autosaveLabel(snapshot: AutosaveSnapshot, invalid: boolean, formatTime: (iso: string) => string): string {
  if (invalid) return "Chưa lưu · sửa các câu được đánh dấu";
  switch (snapshot.status) {
    case "pending":
      return "Có thay đổi chưa lưu";
    case "saving":
      return "Đang lưu…";
    case "offline":
      return "Mất kết nối · đã giữ trên máy này";
    case "error":
      return "Chưa lưu được · thử lại";
    case "conflict":
      return "Form vừa được sửa ở nơi khác";
    default:
      return snapshot.lastSavedAt ? `đã lưu lúc ${formatTime(snapshot.lastSavedAt)}` : "tự lưu";
  }
}
