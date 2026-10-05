import { userProfileSchema, type UpdateUserProfileInput, type UserProfileDto } from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";

/**
 * VERIFIED `GET/PATCH /users/me/profile` (Story IR.4b part A, shared
 * `userProfileSchema` / `updateUserProfileSchema`): display name, birth year,
 * school, school year and goal — the onboarding answers (Figma 12 / account
 * 15g) that are not FR-6 matching fields. `demographics` stays the source for
 * the rest.
 */
export type UserProfile = UserProfileDto;

/**
 * `null` on a 404 (a backend without the route): the shell then falls back to
 * the email for the display name, without an error. Kept while the session
 * shell treats the profile as best-effort; IR.5 removes this tolerance.
 */
export async function getUserProfile(signal?: AbortSignal): Promise<UserProfile | null> {
  try {
    return await apiRequest("/users/me/profile", { schema: userProfileSchema, signal });
  } catch (error) {
    if (isApiError(error) && error.kind === "http" && error.status === 404) return null;
    throw error;
  }
}

/** Partial update: an absent key keeps the stored value, `null` clears it. */
export function updateUserProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
  return apiRequest("/users/me/profile", { method: "PATCH", body: input, schema: userProfileSchema });
}
