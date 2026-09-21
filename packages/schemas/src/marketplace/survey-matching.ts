import { SurveyTargetingCriteria } from "../forms/form-targeting.schema";
import { DemographicProfileDto } from "../users/demographic-profile.schema";

/**
 * Determines whether a respondent's demographic profile satisfies a survey's targeting criteria.
 *
 * Matching Rules:
 * 1. If targeting is null, undefined, or empty (no criteria set) -> returns true (open to all).
 * 2. If targeting specifies criteria and profile is null/undefined -> returns false.
 * 3. Logical AND across categories: All specified criteria categories must be satisfied.
 * 4. Logical OR within category arrays (e.g. locations, genders, occupations, fieldOfStudy).
 * 5. String comparisons are case-insensitive and whitespace-trimmed.
 */
export function isSurveyTargetingMatch(
  targeting: SurveyTargetingCriteria | null | undefined,
  profile: Partial<DemographicProfileDto> | null | undefined,
): boolean {
  // 1. If no targeting configured, it's open to everyone
  if (!targeting) return true;

  const hasAge = targeting.ageRange != null;
  const hasLocations =
    Array.isArray(targeting.locations) && targeting.locations.length > 0;
  const hasGenders =
    Array.isArray(targeting.genders) && targeting.genders.length > 0;
  const hasOccupations =
    Array.isArray(targeting.occupations) && targeting.occupations.length > 0;
  const hasFieldOfStudy =
    Array.isArray(targeting.fieldOfStudy) && targeting.fieldOfStudy.length > 0;

  // If targeting object is empty or has no active constraints
  if (
    !hasAge &&
    !hasLocations &&
    !hasGenders &&
    !hasOccupations &&
    !hasFieldOfStudy
  ) {
    return true;
  }

  // If there are criteria but no profile provided, respondent cannot qualify
  if (!profile) return false;

  // 2. Age Range check
  if (hasAge && targeting.ageRange) {
    if (profile.age == null || typeof profile.age !== "number") {
      return false;
    }
    if (
      profile.age < targeting.ageRange.min ||
      profile.age > targeting.ageRange.max
    ) {
      return false;
    }
  }

  // 3. Location check
  if (hasLocations && targeting.locations) {
    if (!profile.location || profile.location.trim().length === 0) {
      return false;
    }
    const normalizedUserLoc = profile.location.trim().toLowerCase();
    const matchesLocation = targeting.locations.some(
      (loc) => loc.trim().toLowerCase() === normalizedUserLoc,
    );
    if (!matchesLocation) {
      return false;
    }
  }

  // 4. Gender check
  if (hasGenders && targeting.genders) {
    if (!profile.gender) {
      return false;
    }
    if (!targeting.genders.includes(profile.gender)) {
      return false;
    }
  }

  // 5. Occupation check
  if (hasOccupations && targeting.occupations) {
    if (!profile.occupation || profile.occupation.trim().length === 0) {
      return false;
    }
    const normalizedUserOcc = profile.occupation.trim().toLowerCase();
    const matchesOccupation = targeting.occupations.some(
      (occ) => occ.trim().toLowerCase() === normalizedUserOcc,
    );
    if (!matchesOccupation) {
      return false;
    }
  }

  // 6. Field of Study check
  if (hasFieldOfStudy && targeting.fieldOfStudy) {
    if (!profile.fieldOfStudy || profile.fieldOfStudy.trim().length === 0) {
      return false;
    }
    const normalizedUserField = profile.fieldOfStudy.trim().toLowerCase();
    const matchesField = targeting.fieldOfStudy.some(
      (field) => field.trim().toLowerCase() === normalizedUserField,
    );
    if (!matchesField) {
      return false;
    }
  }

  return true;
}
