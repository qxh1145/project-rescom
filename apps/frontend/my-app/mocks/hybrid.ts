import type { MockSessionUser } from "./db/session";

/**
 * Gate G hybrid mode (`NEXT_PUBLIC_API_MOCKING=hybrid`, `isHybridMocking`):
 * the session and every real route belong to the backend, and MSW answers only
 * the deferred PRD routes. Those handlers never read the mock session
 * (`mocks/db/session`) — one left in localStorage by `enabled` mode would answer
 * for the wrong user — and never require a form, attempt or user of the mock DB
 * (real ids are backend UUIDs). They answer with demo data for these stand-ins.
 *
 * Authorization stays with the backend and the app: no role is checked here.
 * The admin pages sit behind `SessionGate requireAdmin` (real `/auth/me`), so
 * the admin mock routes simply answer; CSRF is still required on writes.
 */

/** The member whose demo streak, tier, rank and reliability are shown ("Bạn" on the leaderboard). */
export const HYBRID_MEMBER: MockSessionUser = {
  id: "00000000-0000-4000-8000-00000000d001",
  // The demo fixture member, so the reliability screen gets its Figma seed rows.
  email: "minh.le@fpt.edu.vn",
  name: "Bạn",
  role: "USER",
  profileComplete: true,
};

/** Recorded as the decider of demo disputes and quality reviews. */
export const HYBRID_ADMIN: MockSessionUser = {
  id: "00000000-0000-4000-8000-00000000d002",
  email: "admin@demo.rescom.local",
  name: "Quản trị viên",
  role: "ADMIN",
  profileComplete: true,
};

/** FNV-1a: the same id always yields the same demo numbers. */
export function demoSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
