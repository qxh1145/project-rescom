import { formBlockSchema } from "@rescom/schemas";
import { z } from "zod";
import { aiAttentionSuggestionSchema } from "./builder-ai.ts";
import type { BuilderDoc } from "./builder-blocks.ts";

/**
 * Offline copy of the builder draft (localStorage, one key per form). Every
 * edit is written here before the debounced `PATCH /forms/:id/draft`, so a
 * lost connection or a closed tab never loses work. The entry remembers the
 * server `updatedAt` it was based on: on the next load it is restored
 * silently when the server has not changed since, and offered otherwise.
 */

export const BUILDER_DRAFT_KEY_PREFIX = "rescom:builder-draft:";
/** Unsaved local copies older than this are ignored (and removed). */
export const BUILDER_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const localDraftSchema = z.object({
  version: z.literal(1),
  formId: z.string().min(1),
  baseUpdatedAt: z.string().nullable(),
  savedAt: z.number(),
  /** Edits not yet confirmed by the server. */
  dirty: z.boolean(),
  doc: z.object({
    title: z.string(),
    description: z.string(),
    blocks: z.array(formBlockSchema),
    sections: z.array(z.object({ id: z.string(), title: z.string(), blockIds: z.array(z.string()) })),
    settings: z.record(z.unknown()).optional(),
    minTimeBarrierSeconds: z.number().optional(),
  }),
  pending: z.array(aiAttentionSuggestionSchema).default([]),
  aiBlockIds: z.array(z.string()).default([]),
});
export type LocalBuilderDraft = z.infer<typeof localDraftSchema>;

export function builderDraftKey(formId: string): string {
  return `${BUILDER_DRAFT_KEY_PREFIX}${formId}`;
}

export function saveLocalDraft(
  storage: StorageLike,
  entry: Omit<LocalBuilderDraft, "version" | "savedAt" | "doc"> & { doc: BuilderDoc },
  now = Date.now(),
): boolean {
  try {
    storage.setItem(builderDraftKey(entry.formId), JSON.stringify({ ...entry, version: 1, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function loadLocalDraft(storage: StorageLike, formId: string, now = Date.now()): LocalBuilderDraft | null {
  let raw: string | null;
  try {
    raw = storage.getItem(builderDraftKey(formId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = localDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.formId !== formId || now - parsed.data.savedAt > BUILDER_DRAFT_MAX_AGE_MS) {
      clearLocalDraft(storage, formId);
      return null;
    }
    return parsed.data;
  } catch {
    clearLocalDraft(storage, formId);
    return null;
  }
}

export function clearLocalDraft(storage: StorageLike, formId: string): void {
  try {
    storage.removeItem(builderDraftKey(formId));
  } catch {
    // Storage blocked: nothing to clear.
  }
}

export type RestoreDecision = "use-server" | "restore" | "ask";

/**
 * - no unsaved local copy → the server version;
 * - unsaved copy based on the current server version → restore it (and save);
 * - unsaved copy but the server changed since → ask the publisher.
 */
export function decideRestore(local: LocalBuilderDraft | null, serverUpdatedAt: string): RestoreDecision {
  if (!local || !local.dirty) return "use-server";
  return local.baseUpdatedAt === serverUpdatedAt ? "restore" : "ask";
}
