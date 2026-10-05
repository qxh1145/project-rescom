/**
 * Notices the login page shows after leaving a session.
 *
 * 15e "Bạn đã được đăng xuất" — signal `/login?reason=session-replaced[&at=<ISO time>]`.
 * VERIFIED (plan 5.6): the backend keeps one session per user and answers a
 * request on a session that a newer login replaced with 401
 * `AUTH_SESSION_REPLACED` (other revocations keep `AUTH_SESSION_REVOKED`).
 * The backend also clears the cookies on that first answer, so every later
 * request only says `AUTH_UNAUTHORIZED`: `apiRequest` therefore remembers the
 * replacement (`markSessionReplaced`) the moment it sees the code, and the
 * session status reads that mark (`wasSessionReplaced`) when it settles on
 * "signed out", whichever request noticed first. The login page clears it.
 * The backend does not send the other device's sign-in time, so `at` is
 * absent in practice.
 *
 * `/login?reason=password-reset`: the password was just reset (plan 5.4).
 */

export const SESSION_REPLACED_REASON = "session-replaced";
export const PASSWORD_RESET_REASON = "password-reset";
export const SESSION_REPLACED_CODE = "AUTH_SESSION_REPLACED";

export interface SessionReplacedNotice {
  /** When the other device signed in, if the signal carried it. */
  at: Date | null;
}

interface ReadableParams {
  get(name: string): string | null;
}

export function readSessionReplacedNotice(params: ReadableParams): SessionReplacedNotice | null {
  if (params.get("reason") !== SESSION_REPLACED_REASON) return null;
  const raw = params.get("at");
  const time = raw ? Date.parse(raw) : Number.NaN;
  return { at: Number.isNaN(time) ? null : new Date(time) };
}

export function readPasswordResetNotice(params: ReadableParams): boolean {
  return params.get("reason") === PASSWORD_RESET_REASON;
}

/** A mark older than this is ignored (a stale tab, a later unrelated sign-out). */
export const SESSION_REPLACED_MARK_TTL_MS = 10 * 60_000;
const MARK_KEY = "rescom:session-replaced-at";
let markInMemory: number | null = null;

function storage(): Storage | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/** Called by `apiRequest` on any 401 `AUTH_SESSION_REPLACED`. */
export function markSessionReplaced(now: number = Date.now()): void {
  markInMemory = now;
  try {
    storage()?.setItem(MARK_KEY, String(now));
  } catch {
    // Storage blocked: this tab's memory is enough for the redirect.
  }
}

export function wasSessionReplaced(now: number = Date.now()): boolean {
  let at = markInMemory;
  try {
    const raw = storage()?.getItem(MARK_KEY);
    if (raw && Number.isFinite(Number(raw))) at = Number(raw);
  } catch {
    // ignore
  }
  return at !== null && now - at < SESSION_REPLACED_MARK_TTL_MS;
}

export function clearSessionReplaced(): void {
  markInMemory = null;
  try {
    storage()?.removeItem(MARK_KEY);
  } catch {
    // ignore
  }
}
