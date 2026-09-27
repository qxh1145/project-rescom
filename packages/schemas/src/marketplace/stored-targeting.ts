import {
  surveyTargetingSchema,
  SurveyTargetingCriteria,
} from "../forms/form-targeting.schema";

export type StoredTargetingParseResult =
  | { ok: true; targeting: SurveyTargetingCriteria | null }
  | { ok: false };

/**
 * Runtime-validates a persisted `FormVersion.targetingJson` before it is used
 * for eligibility (Marketplace feed, attempt start).
 *
 * Writes are validated by `surveyTargetingSchema`, so only legacy or corrupt
 * rows fail here. Callers must fail CLOSED on `{ ok: false }` (exclude the
 * survey / treat the respondent as not eligible): casting instead would let
 * unknown keys or non-array values match everyone, and a non-string entry
 * would throw inside the matcher.
 *
 * `null`/`undefined` means "no targeting" (open to all).
 */
export function parseStoredTargeting(raw: unknown): StoredTargetingParseResult {
  if (raw === null || raw === undefined) {
    return { ok: true, targeting: null };
  }
  const result = surveyTargetingSchema.safeParse(raw);
  return result.success ? { ok: true, targeting: result.data } : { ok: false };
}
