/**
 * Respondent data kept in the browser between visits: in-Rescom answer
 * drafts (localStorage), Google Forms code drafts and stashed submit results
 * (sessionStorage). Removed on logout so the next person on this browser
 * never sees them (same place the onboarding drafts are cleared).
 */
export const PARTICIPATION_STORAGE_PREFIXES = [
  "rescom:survey-draft:",
  "rescom:google-form-draft:",
  "rescom:survey-submission:",
  // Guest proof of an attempt's uploads (`file-upload-service.ts`, sessionStorage).
  "rescom:storage-capability:",
  // Publisher side: Google Forms wizard draft and the one-time completion code hand-off.
  "rescom:create-gform-draft:",
  "rescom:created-form-code:",
  // Publisher side: the draft's retry Idempotency-Key (`create-storage.ts`) — a stranger on this
  // browser must not resume or replay another publisher's in-flight survey creation.
  "rescom:create-gform-idempotency:",
  // Publisher side: unsaved Form Builder copies can contain survey content.
  "rescom:builder-draft:",
] as const;

type KeyedStorage = Pick<Storage, "removeItem" | "key"> & { readonly length: number };

export function clearParticipationStorage(...stores: Array<KeyedStorage | null | undefined>): void {
  for (const storage of stores) {
    if (!storage) continue;
    try {
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key && PARTICIPATION_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key);
      }
      for (const key of keys) storage.removeItem(key);
    } catch {
      // Blocked storage holds nothing to clear.
    }
  }
}

/** Both browser stores (null entries when unavailable). */
export function browserParticipationStores(): Array<Storage | null> {
  if (typeof window === "undefined") return [];
  const pick = (read: () => Storage): Storage | null => {
    try {
      return read();
    } catch {
      return null;
    }
  };
  return [pick(() => window.localStorage), pick(() => window.sessionStorage)];
}
