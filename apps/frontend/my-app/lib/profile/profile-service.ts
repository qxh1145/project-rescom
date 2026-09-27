import { z } from "zod";
import { isApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";

/**
 * ASSUMED API CONTRACT — the backend has no route for these fields yet.
 * Figma onboarding 12 / account 15g collect data that `demographic_profiles`
 * does not store: display name, birth year (the backend keeps `age`), school,
 * school year and the user's goal. They live behind `/users/me/profile`
 * until the backend adds them. `demographics` stays the source for the rest.
 */
export const userGoalSchema = z.enum(["EARN", "COLLECT", "BOTH"]);
export type UserGoal = z.infer<typeof userGoalSchema>;

export const userProfileSchema = z.object({
  displayName: z.string().nullable(),
  birthYear: z.number().int().nullable(),
  school: z.string().nullable(),
  schoolYear: z.string().nullable(),
  goal: userGoalSchema.nullable(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const updateUserProfileSchema = userProfileSchema.partial();
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileSchema>;

/**
 * `null` when the route does not exist yet (404 from the real backend): the
 * shell then falls back to the email for the display name, without an error.
 */
export async function getUserProfile(signal?: AbortSignal): Promise<UserProfile | null> {
  try {
    return await apiRequest("/users/me/profile", { schema: userProfileSchema, signal });
  } catch (error) {
    if (isApiError(error) && error.kind === "http" && error.status === 404) return null;
    throw error;
  }
}

export function updateUserProfile(input: UpdateUserProfileInput): Promise<UserProfile> {
  return apiRequest("/users/me/profile", { method: "PATCH", body: input, schema: userProfileSchema });
}
