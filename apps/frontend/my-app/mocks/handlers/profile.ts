import { http } from "msw";
import {
  isBirthYearAllowed,
  updateUserProfileSchema,
  USER_PROFILE_BIRTH_YEAR_MESSAGE,
  userProfileSchema,
  type UserProfileDto,
} from "@rescom/schemas";
import { apiUrl } from "@/lib/api/config";
import { getMockSessionUser } from "../db/session";
import { createCollection } from "../db/store";
import { fail, missingCsrf, ok, unauthorized } from "../envelope";
import { applyScenario } from "../scenarios";

/**
 * Mirrors `apps/backend/src/modules/users/presentation/user-profile.controller.ts`
 * (VERIFIED): GET / PATCH `/users/me/profile` with the shared schemas — partial
 * update (absent keeps, `null` clears, blank text → `null`), the 13–100 age
 * bound of `birthYear`, and 400 `VALIDATION_ERROR` with `format()` details.
 * An account without a stored profile answers every field `null` until the
 * first PATCH, like the backend.
 */
const profiles = createCollection<Record<string, UserProfileDto>>("user-profiles", () => ({}));

function profileOf(userId: string): UserProfileDto {
  return (
    profiles.get()[userId] ?? {
      displayName: null,
      birthYear: null,
      school: null,
      schoolYear: null,
      goal: null,
    }
  );
}

/** `ZodValidationPipe` / `UserProfileValidationException` answer. */
function validationError(message: string, details: unknown) {
  return fail(400, "VALIDATION_ERROR", message, { details });
}

export const profileHandlers = [
  http.get(apiUrl("/users/me/profile"), async () => {
    const forced = await applyScenario("profile");
    if (forced) return forced;
    const user = await getMockSessionUser();
    if (!user) return unauthorized();
    // `parse`: a drift from the shared schema must fail loudly.
    return ok(userProfileSchema.parse(profileOf(user.id)));
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
      return validationError(parsed.error.errors[0]?.message ?? "Validation failed", parsed.error.format());
    }
    const { birthYear } = parsed.data;
    if (typeof birthYear === "number" && !isBirthYearAllowed(birthYear, new Date().getFullYear())) {
      return validationError(USER_PROFILE_BIRTH_YEAR_MESSAGE, {
        _errors: [],
        birthYear: { _errors: [USER_PROFILE_BIRTH_YEAR_MESSAGE] },
      });
    }
    const next = userProfileSchema.parse({ ...profileOf(user.id), ...parsed.data });
    profiles.update((all) => {
      all[user.id] = next;
    });
    return ok(next);
  }),
];
