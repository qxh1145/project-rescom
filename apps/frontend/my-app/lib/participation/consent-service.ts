import { z } from "zod";
import { isApiError } from "../api/api-error.ts";
import { apiRequest } from "../api/client.ts";

/**
 * Integrity telemetry notice (Figma 14 "Thông báo dữ liệu chất lượng",
 * "Thông báo phiên bản 1"). The backend stores `IntegrityConsent
 * { purpose, noticeVersion }` per user and telemetry batches carry
 * `consentNoticeVersion`, but there is no consent route yet.
 *
 * ASSUMED API CONTRACT:
 * - `GET /integrity/consent` → `integrityConsentSchema`
 * - `POST /integrity/consent` `{ noticeVersion }` (CSRF) → `integrityConsentSchema`
 *
 * ASSUMED product rule: accepting a notice version is remembered per user, so
 * the screen is shown again only when the version changes.
 */
export const integrityConsentSchema = z.object({
  currentVersion: z.number().int().positive(),
  acceptedVersion: z.number().int().positive().nullable(),
  acceptedAt: z.string().datetime().nullable(),
});
export type IntegrityConsent = z.infer<typeof integrityConsentSchema>;

/** Version shown when the status cannot be read. */
export const FALLBACK_NOTICE_VERSION = 1;

export function getIntegrityConsent(signal?: AbortSignal): Promise<IntegrityConsent> {
  return apiRequest("/integrity/consent", { schema: integrityConsentSchema, signal });
}

export function acceptIntegrityConsent(noticeVersion: number, signal?: AbortSignal): Promise<IntegrityConsent> {
  return apiRequest("/integrity/consent", {
    method: "POST",
    body: { noticeVersion },
    schema: integrityConsentSchema,
    signal,
  });
}

export function hasAcceptedCurrentNotice(consent: IntegrityConsent | null | undefined): boolean {
  return Boolean(consent && consent.acceptedVersion !== null && consent.acceptedVersion >= consent.currentVersion);
}

/**
 * The route may not exist on the real backend yet (404/405/501): recording the
 * acceptance then must not block the survey.
 */
export function isConsentRouteMissing(error: unknown): boolean {
  return isApiError(error) && error.kind === "http" && (error.status === 404 || error.status === 405 || error.status === 501);
}
