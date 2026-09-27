import { mockRepository } from "@/lib/mock/repository.ts";
import { loadStore } from "@/lib/mock/store.ts";
import { toMockUuid } from "../data/auth";

export interface MockSessionUser {
  /** UUID as exposed by the API. */
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
  /** Demographic profile complete (legacy `isOnboarded`). */
  profileComplete: boolean;
}

/**
 * The one seam between new MSW handlers and the signed-in user. Sessions still
 * live in the legacy demo store (`lib/mock`) because the auth handlers use it;
 * swap this implementation when auth moves into `mocks/db`.
 */
export async function getMockSessionUser(): Promise<MockSessionUser | null> {
  const session = await mockRepository.getCurrentSession();
  if (!session?.user) return null;
  const { user } = session;
  return {
    id: toMockUuid(user.id),
    email: user.email,
    name: user.name,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    profileComplete: user.isOnboarded,
  };
}

/**
 * Any mock user by email (not only the signed-in one) — for admin actions
 * that credit/refund a survey owner or a top-up requester. Same mapping as
 * `getMockSessionUser`.
 */
export function findMockUserByEmail(email: string): MockSessionUser | null {
  const user = Object.values(loadStore().users).find((candidate) => candidate.email === email);
  if (!user) return null;
  return {
    id: toMockUuid(user.id),
    email: user.email,
    name: user.name,
    role: user.role === "ADMIN" ? "ADMIN" : "USER",
    profileComplete: user.isOnboarded,
  };
}
