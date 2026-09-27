/**
 * Email carried between two auth screens without putting it in the URL
 * (history, logs, referrers): 15b → 15c ("Đã gửi yêu cầu" shows it) and the
 * Google callback → 15d. Tab-scoped `sessionStorage`; read with
 * `useSyncExternalStore(subscribePendingEmail, () => readPendingEmail(kind), () => null)`.
 */

export type PendingEmailKind = "password-reset" | "google-link";

const KEY_PREFIX = "rescom:pending-email:";

export function savePendingEmail(kind: PendingEmailKind, email: string): void {
  try {
    window.sessionStorage.setItem(KEY_PREFIX + kind, email);
  } catch {
    // Storage blocked: the next screen falls back to its no-email copy.
  }
}

export function readPendingEmail(kind: PendingEmailKind): string | null {
  try {
    return window.sessionStorage.getItem(KEY_PREFIX + kind);
  } catch {
    return null;
  }
}

export function clearPendingEmail(kind: PendingEmailKind): void {
  try {
    window.sessionStorage.removeItem(KEY_PREFIX + kind);
  } catch {
    // ignore
  }
}

/** The value only changes through this tab's own navigation, so there is nothing to subscribe to. */
export function subscribePendingEmail(): () => void {
  return () => {};
}
