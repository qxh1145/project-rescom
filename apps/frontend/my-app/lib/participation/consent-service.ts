import {
  INTEGRITY_CONSENT_NOTICE_VERSION,
  INTEGRITY_CONSENT_VERSION_MISMATCH_CODE,
  integrityConsentSchema,
  type AcceptIntegrityConsentInput,
  type IntegrityConsentDto,
} from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";

/**
 * Integrity telemetry notice (Figma 14 "Thông báo dữ liệu chất lượng",
 * "Thông báo phiên bản 1"). Accepting a notice version is remembered per
 * user (`IntegrityConsent`), so the screen is shown again only when the
 * version changes; telemetry batches carry the accepted version.
 *
 * VERIFIED (`integrity-consent.controller.ts`, session required):
 * - `GET /integrity/consent` → `integrityConsentSchema`
 * - `POST /integrity/consent` `{ noticeVersion }` (CSRF + JSON) →
 *   `integrityConsentSchema`; accepting the same version again is an
 *   idempotent 200 with the original `acceptedAt`; another version is 409
 *   `INTEGRITY_CONSENT_VERSION_MISMATCH` (`details.currentVersion`).
 */
export { integrityConsentSchema };
export type IntegrityConsent = IntegrityConsentDto;

/** Version shown when the status cannot be read (no response at all). */
export const FALLBACK_NOTICE_VERSION = INTEGRITY_CONSENT_NOTICE_VERSION;

export function getIntegrityConsent(signal?: AbortSignal): Promise<IntegrityConsent> {
  return apiRequest("/integrity/consent", { schema: integrityConsentSchema, signal });
}

export function acceptIntegrityConsent(noticeVersion: number, signal?: AbortSignal): Promise<IntegrityConsent> {
  return apiRequest("/integrity/consent", {
    method: "POST",
    body: { noticeVersion } satisfies AcceptIntegrityConsentInput,
    schema: integrityConsentSchema,
    signal,
  });
}

export function hasAcceptedCurrentNotice(consent: IntegrityConsent | null | undefined): boolean {
  return Boolean(consent && consent.acceptedVersion !== null && consent.acceptedVersion >= consent.currentVersion);
}

/**
 * No response at all (offline, DNS…): the only consent failure the start
 * screen tolerates — the notice is shown from the fallback version and an
 * unrecorded acceptance does not block the survey. Every HTTP error is shown.
 */
export function isConsentUnreachable(error: unknown): boolean {
  return isApiError(error) && error.kind === "network";
}

/** 409: the notice changed since it was shown; it must be read again. */
export function isConsentNoticeOutdated(error: unknown): boolean {
  return isApiError(error) && error.code === INTEGRITY_CONSENT_VERSION_MISMATCH_CODE;
}
