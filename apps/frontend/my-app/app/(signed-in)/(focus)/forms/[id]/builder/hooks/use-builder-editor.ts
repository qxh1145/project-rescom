"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isApiError } from "@/lib/api/api-error";
import {
  applyAiDraft,
  confirmAttentionSuggestion,
  dismissAttentionSuggestion,
  prunePendingSuggestions,
  type AiAttentionSuggestion,
} from "@/lib/forms/builder-ai";
import { createAutosaveController, type AutosaveController, type AutosaveSnapshot } from "@/lib/forms/builder-autosave";
import { emptyDoc, hasIssues, validateDraft, validateForPublish, type BuilderDoc, type DocIssues } from "@/lib/forms/builder-blocks";
import {
  clearLocalDraft,
  decideRestore,
  loadLocalDraft,
  saveLocalDraft,
  type LocalBuilderDraft,
  type StorageLike,
} from "@/lib/forms/builder-offline";
import {
  docFromForm,
  draftPayloadOf,
  getAiConversation,
  getBuilderForm,
  saveBuilderDraft,
  type BuilderForm,
  type DraftPayload,
} from "@/lib/forms/builder-service";

const AUTOSAVE_DELAY_MS = 1000;

function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export interface BuilderEditor {
  form: BuilderForm | null;
  loadError: unknown;
  loading: boolean;
  reload: () => void;
  doc: BuilderDoc;
  /** Issues shown on the cards: draft rules, plus the publish rules once `checkForPublish` ran. */
  issues: DocIssues;
  /** The draft cannot be autosaved (draft rules only). */
  draftInvalid: boolean;
  /** Runs the publish rules and keeps showing them on the cards (P2 / C1). */
  checkForPublish: () => DocIssues;
  readOnly: boolean;
  selectedId: string | null;
  select: (blockId: string | null) => void;
  /** Applies a pure document change (autosaved) and optionally announces it. */
  change: (recipe: (doc: BuilderDoc) => BuilderDoc, announcement?: string) => void;
  announcement: string;
  announce: (message: string) => void;
  autosave: AutosaveSnapshot;
  /** Saves now; resolves with the resulting autosave state. */
  saveNow: () => Promise<AutosaveSnapshot>;
  // AI review (13c)
  pending: AiAttentionSuggestion[];
  aiBlockIds: ReadonlySet<string>;
  aiReviewActive: boolean;
  confirmSuggestion: (blockId: string, expected?: AiAttentionSuggestion["expectedValue"]) => void;
  dismissSuggestion: (blockId: string) => void;
  applyAiFromConversation: () => Promise<boolean>;
  undoAi: (() => void) | null;
  addAiBlock: (blockId: string, suggestion: AiAttentionSuggestion | null) => void;
  // Conflict / restore
  restoreOffer: LocalBuilderDraft | null;
  acceptRestore: () => void;
  rejectRestore: () => void;
  reloadFromServer: () => Promise<void>;
  overwriteServer: () => Promise<void>;
}

const IDLE: AutosaveSnapshot = { status: "idle", baseline: null, lastSavedAt: null, error: null, hasPending: false };

/**
 * State of the Form Builder: loads `GET /forms/:id`, keeps the document,
 * writes every change to the offline cache and autosaves valid drafts with
 * `PATCH /forms/:id/draft` (see `lib/forms/builder-autosave.ts`).
 */
export function useBuilderEditor(formId: string): BuilderEditor {
  const [form, setForm] = useState<BuilderForm | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [doc, setDoc] = useState<BuilderDoc>(emptyDoc);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [autosave, setAutosave] = useState<AutosaveSnapshot>(IDLE);
  const [pending, setPending] = useState<AiAttentionSuggestion[]>([]);
  const [aiBlockIds, setAiBlockIds] = useState<string[]>([]);
  const [aiUndoDoc, setAiUndoDoc] = useState<BuilderDoc | null>(null);
  const [restoreOffer, setRestoreOffer] = useState<LocalBuilderDraft | null>(null);
  const [publishChecked, setPublishChecked] = useState(false);

  const controllerRef = useRef<AutosaveController<DraftPayload> | null>(null);
  const stateRef = useRef({ doc, pending, aiBlockIds });
  useEffect(() => {
    stateRef.current = { doc, pending, aiBlockIds };
  });

  const readOnly = form !== null && form.status !== "DRAFT";
  const draftIssues = useMemo(() => validateDraft(doc), [doc]);
  const issues = useMemo(() => (publishChecked ? validateForPublish(doc) : draftIssues), [publishChecked, doc, draftIssues]);

  const writeLocal = useCallback(
    (next: { doc: BuilderDoc; pending: AiAttentionSuggestion[]; aiBlockIds: string[] }, dirty: boolean) => {
      const storage = browserStorage();
      if (!storage) return;
      saveLocalDraft(storage, {
        formId,
        baseUpdatedAt: controllerRef.current?.snapshot().baseline ?? null,
        dirty,
        doc: next.doc,
        pending: next.pending,
        aiBlockIds: next.aiBlockIds,
      });
    },
    [formId],
  );

  // One autosave controller per form.
  useEffect(() => {
    const controller = createAutosaveController<DraftPayload>({
      delayMs: AUTOSAVE_DELAY_MS,
      save: async (payload, clientUpdatedAt) => {
        const saved = await saveBuilderDraft(formId, payload, clientUpdatedAt);
        setForm(saved);
        return { updatedAt: saved.updatedAt };
      },
      isConflict: (error) => isApiError(error) && error.code === "FORM_EDIT_CONFLICT",
      isOffline: (error) => isApiError(error) && error.kind === "network",
      onChange: (snapshot) => {
        setAutosave(snapshot);
        if (snapshot.status === "saved" && !snapshot.hasPending) writeLocal(stateRef.current, false);
      },
    });
    controllerRef.current = controller;
    const online = () => void controller.flush();
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("online", online);
      controller.dispose();
      controllerRef.current = null;
    };
  }, [formId, writeLocal]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const snapshot = controllerRef.current?.snapshot();
      if (snapshot?.hasPending || snapshot?.status === "saving") event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const queueSave = useCallback((next: BuilderDoc) => {
    if (hasIssues(validateDraft(next))) return;
    controllerRef.current?.queue(draftPayloadOf(next));
  }, []);

  const commit = useCallback(
    (next: { doc: BuilderDoc; pending?: AiAttentionSuggestion[]; aiBlockIds?: string[] }) => {
      const merged = {
        doc: next.doc,
        pending: prunePendingSuggestions(next.doc, next.pending ?? stateRef.current.pending),
        aiBlockIds: next.aiBlockIds ?? stateRef.current.aiBlockIds,
      };
      stateRef.current = merged;
      setDoc(merged.doc);
      setPending(merged.pending);
      setAiBlockIds(merged.aiBlockIds);
      writeLocal(merged, true);
      queueSave(merged.doc);
    },
    [queueSave, writeLocal],
  );

  // Load (and reload) the form.
  useEffect(() => {
    const controller = new AbortController();
    getBuilderForm(formId, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        const { doc: serverDoc } = docFromForm(loaded);
        const storage = browserStorage();
        const local = storage ? loadLocalDraft(storage, formId) : null;
        const decision = loaded.status === "DRAFT" ? decideRestore(local, loaded.updatedAt) : "use-server";
        setForm(loaded);
        setLoadError(null);
        controllerRef.current?.setBaseline(loaded.updatedAt);
        const base = {
          doc: decision === "restore" && local ? (local.doc as BuilderDoc) : serverDoc,
          pending: local?.pending ?? [],
          aiBlockIds: local?.aiBlockIds ?? [],
        };
        const pendingNow = prunePendingSuggestions(base.doc, base.pending);
        stateRef.current = { ...base, pending: pendingNow };
        setDoc(base.doc);
        setPending(pendingNow);
        setAiBlockIds(base.aiBlockIds);
        setRestoreOffer(decision === "ask" ? local : null);
        if (decision === "restore") {
          queueSave(base.doc);
          setAnnouncement("Đã khôi phục các thay đổi chưa lưu trên máy này.");
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (!controller.signal.aborted) setLoadError(error);
      });
    return () => controller.abort();
  }, [formId, loadVersion, queueSave]);

  const change = useCallback(
    (recipe: (current: BuilderDoc) => BuilderDoc, message?: string) => {
      if (readOnly) return;
      const next = recipe(stateRef.current.doc);
      if (next === stateRef.current.doc) return;
      commit({ doc: next });
      if (message) setAnnouncement(message);
    },
    [commit, readOnly],
  );

  const applyAiFromConversation = useCallback(async () => {
    const conversation = await getAiConversation(formId);
    if (!conversation.draft) return false;
    const previous = stateRef.current.doc;
    const applied = applyAiDraft(previous, conversation.draft);
    setAiUndoDoc((existing) => existing ?? previous);
    commit({ doc: applied.doc, pending: applied.pending, aiBlockIds: applied.aiBlockIds });
    setSelectedId(applied.pending[0]?.blockId ?? null);
    setAnnouncement(`Đã đưa bản nháp AI vào form: ${applied.doc.blocks.length} câu.`);
    return true;
  }, [commit, formId]);

  const reloadFromServer = useCallback(async () => {
    const loaded = await getBuilderForm(formId);
    const storage = browserStorage();
    if (storage) clearLocalDraft(storage, formId);
    controllerRef.current?.discardPending();
    controllerRef.current?.setBaseline(loaded.updatedAt);
    const { doc: serverDoc } = docFromForm(loaded);
    stateRef.current = { doc: serverDoc, pending: [], aiBlockIds: [] };
    setForm(loaded);
    setDoc(serverDoc);
    setPending([]);
    setAiBlockIds([]);
    setRestoreOffer(null);
    setAnnouncement("Đã tải bản mới nhất của form.");
  }, [formId]);

  const overwriteServer = useCallback(async () => {
    const loaded = await getBuilderForm(formId);
    controllerRef.current?.setBaseline(loaded.updatedAt);
    controllerRef.current?.queue(draftPayloadOf(stateRef.current.doc));
    await controllerRef.current?.flush();
  }, [formId]);

  return {
    form,
    loadError,
    loading: form === null && loadError === null,
    reload: () => {
      setLoadError(null);
      setLoadVersion((v) => v + 1);
    },
    doc,
    issues,
    draftInvalid: hasIssues(draftIssues),
    checkForPublish: () => {
      setPublishChecked(true);
      return validateForPublish(stateRef.current.doc);
    },
    readOnly,
    selectedId: selectedId && doc.blocks.some((block) => block.id === selectedId) ? selectedId : null,
    select: setSelectedId,
    change,
    announcement,
    announce: setAnnouncement,
    autosave,
    saveNow: async () => {
      await controllerRef.current?.flush();
      return controllerRef.current?.snapshot() ?? IDLE;
    },
    pending,
    aiBlockIds: new Set(aiBlockIds),
    aiReviewActive: aiUndoDoc !== null || pending.length > 0,
    confirmSuggestion: (blockId, expected) => {
      const result = confirmAttentionSuggestion(stateRef.current.doc, stateRef.current.pending, blockId, expected);
      commit({ doc: result.doc, pending: result.pending });
      setAnnouncement("Đã xác nhận câu kiểm tra chú ý.");
    },
    dismissSuggestion: (blockId) => {
      commit({ doc: stateRef.current.doc, pending: dismissAttentionSuggestion(stateRef.current.pending, blockId) });
      setAnnouncement("Đã bỏ gợi ý kiểm tra chú ý. Câu hỏi vẫn được giữ.");
    },
    applyAiFromConversation,
    undoAi: aiUndoDoc
      ? () => {
          commit({ doc: aiUndoDoc, pending: [], aiBlockIds: [] });
          setAiUndoDoc(null);
          setSelectedId(null);
          setAnnouncement("Đã hoàn tác bản nháp AI.");
        }
      : null,
    addAiBlock: (blockId, suggestion) => {
      commit({
        doc: stateRef.current.doc,
        pending: suggestion ? [...stateRef.current.pending, suggestion] : stateRef.current.pending,
        aiBlockIds: [...stateRef.current.aiBlockIds, blockId],
      });
    },
    restoreOffer,
    acceptRestore: () => {
      if (!restoreOffer) return;
      setRestoreOffer(null);
      void overwriteWith(restoreOffer);
    },
    rejectRestore: () => {
      const storage = browserStorage();
      if (storage) clearLocalDraft(storage, formId);
      setRestoreOffer(null);
    },
    reloadFromServer,
    overwriteServer,
  };

  function overwriteWith(local: LocalBuilderDraft) {
    commit({ doc: local.doc as BuilderDoc, pending: local.pending, aiBlockIds: local.aiBlockIds });
    setAnnouncement("Đã dùng bản trên máy này.");
    return controllerRef.current?.flush();
  }
}
