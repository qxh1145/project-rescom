import { http } from "msw";
import { updateUserProfileSchema, type UserProfile } from "@/lib/profile/profile-service";
import { apiUrl } from "@/lib/api/config";
import { getMockSessionUser } from "../db/session";
import { createCollection } from "../db/store";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/** ASSUMED API CONTRACT: `/users/me/profile` (see `lib/profile/profile-service.ts`). */
const profiles = createCollection<Record<string, UserProfile>>("user-profiles", () => ({}));

function profileOf(userId: string, fallbackName: string): UserProfile {
  return (
    profiles.get()[userId] ?? {
      displayName: fallbackName,
      birthYear: null,
      school: null,
      schoolYear: null,
      goal: null,
    }
  );
}

export const profileHandlers = [
  http.get(apiUrl("/users/me/profile"), async () => {
    const forced = await applyScenario("profile");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    return ok(profileOf(user.id, user.name));
  }),

  http.patch(apiUrl("/users/me/profile"), async ({ request }) => {
    const forced = await applyScenario("profile");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    const csrf = missingCsrf(request);
    if (csrf) return csrf;
    const parsed = updateUserProfileSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail(400, "PROFILE_INVALID_INPUT", "Validation failed", { details: parsed.error.format() });
    }
    const next = { ...profileOf(user.id, user.name), ...parsed.data };
    profiles.update((all) => {
      all[user.id] = next;
    });
    return ok(next);
  }),
];
