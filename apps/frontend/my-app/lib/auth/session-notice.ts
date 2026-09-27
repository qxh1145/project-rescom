/**
 * 15e "Bạn đã được đăng xuất" — ASSUMED signal `/login?reason=session-replaced[&at=<ISO time>]`.
 *
 * The backend keeps one session per user (`SessionService.createSession` →
 * `replaceUserSession`, audited as SESSION_REPLACED). The replaced session's
 * token then fails `validateSession` with a plain 401 `AUTH_UNAUTHORIZED`
 * ("Session claims mismatch"), which cannot be told apart from any other
 * invalid session. No error code maps to this dialog yet; whoever detects the
 * replacement (a future dedicated code) should redirect with this signal.
 */

export const SESSION_REPLACED_REASON = "session-replaced";

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
