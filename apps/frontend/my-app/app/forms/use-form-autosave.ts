"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { UpdateFormDraftInput } from "@rescom/schemas";
import { formMutationFetch } from "./forms-api";

export type AutosaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";
export type AutosaveDraftInput = Omit<UpdateFormDraftInput, "clientUpdatedAt">;

export interface UseFormAutosaveOptions {
  formId: string;
  debounceMs?: number;
  apiBaseUrl?: string;
  onSaveSuccess?: (updatedAt: string) => void;
  onSaveError?: (error: Error) => void;
}

export interface UseFormAutosaveReturn {
  status: AutosaveStatus;
  lastSaved: Date | null;
  statusText: string;
  errorMessage: string | null;
  triggerAutosave: (data: AutosaveDraftInput) => void;
  saveNow: () => Promise<void>;
  setServerUpdatedAt: (updatedAt: string) => void;
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function useFormAutosave({
  formId,
  debounceMs = 1000,
  apiBaseUrl = "/api",
  onSaveSuccess,
  onSaveError,
}: UseFormAutosaveOptions): UseFormAutosaveReturn {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pendingDataRef = useRef<AutosaveDraftInput | null>(null);
  const serverUpdatedAtRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSaveRef = useRef<Promise<void> | null>(null);

  const setServerUpdatedAt = useCallback((updatedAt: string) => {
    serverUpdatedAtRef.current = updatedAt;
    setLastSaved(new Date(updatedAt));
  }, []);

  const drainSaveQueue = useCallback(async () => {
    while (pendingDataRef.current) {
      const data = pendingDataRef.current;
      pendingDataRef.current = null;
      const clientUpdatedAt = serverUpdatedAtRef.current;
      if (!clientUpdatedAt) {
        pendingDataRef.current = data;
        throw new Error("Form version token is unavailable; reload the editor");
      }

      setStatus("saving");
      setErrorMessage(null);
      try {
        const response = await formMutationFetch(
          `${apiBaseUrl}/forms/${formId}/draft`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...data, clientUpdatedAt }),
          },
        );
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(
            result?.error?.message || `Failed to autosave (HTTP ${response.status})`,
          ) as Error & { code?: string; details?: unknown };
          error.code = result?.error?.code;
          error.details = result?.error?.details;
          throw error;
        }

        const updatedAt = result?.data?.updatedAt;
        if (typeof updatedAt !== "string") {
          throw new Error("Autosave response did not include a version token");
        }
        serverUpdatedAtRef.current = updatedAt;
        setLastSaved(new Date(updatedAt));
        onSaveSuccess?.(updatedAt);
      } catch (caught: unknown) {
        pendingDataRef.current ??= data;
        const error = caught instanceof Error ? caught : new Error(String(caught));
        setStatus("error");
        setErrorMessage(error.message || "Failed to save draft");
        onSaveError?.(error);
        throw error;
      }
    }
    setStatus("saved");
  }, [apiBaseUrl, formId, onSaveError, onSaveSuccess]);

  const saveNow = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (activeSaveRef.current) await activeSaveRef.current;
    if (!pendingDataRef.current) return;

    const active = drainSaveQueue().finally(() => {
      if (activeSaveRef.current === active) activeSaveRef.current = null;
    });
    activeSaveRef.current = active;
    await active;
  }, [drainSaveQueue]);

  const triggerAutosave = useCallback(
    (data: AutosaveDraftInput) => {
      pendingDataRef.current = data;
      setStatus("unsaved");
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void saveNow().catch(() => undefined);
      }, debounceMs);
    },
    [debounceMs, saveNow],
  );

  useEffect(
    () => () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    },
    [],
  );

  const statusText =
    status === "saving"
      ? "Saving changes..."
      : status === "saved"
        ? lastSaved
          ? `Saved at ${formatTime(lastSaved)}`
          : "Saved"
        : status === "unsaved"
          ? "Unsaved changes"
          : status === "error"
            ? errorMessage
              ? `Save error: ${errorMessage}`
              : "Error saving"
            : lastSaved
              ? `Saved at ${formatTime(lastSaved)}`
              : "All changes saved";

  return {
    status,
    lastSaved,
    statusText,
    errorMessage,
    triggerAutosave,
    saveNow,
    setServerUpdatedAt,
  };
}
