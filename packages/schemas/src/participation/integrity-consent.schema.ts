import { z } from 'zod';

/**
 * Integrity telemetry notice (Figma 14 "Thông báo dữ liệu chất lượng"):
 * `GET /integrity/consent` and `POST /integrity/consent`. The acceptance is
 * kept per user and notice version in `IntegrityConsent` (AD-9/AD-16:
 * Integrity-owned, consent purpose + notice version), so the notice is shown
 * again only when its version changes.
 */

/** `IntegrityConsent.purpose` of the in-Rescom behavioural telemetry notice. */
export const INTEGRITY_CONSENT_PURPOSE = 'INTEGRITY_TELEMETRY';

/**
 * Version of the notice text the frontend shows ("Thông báo phiên bản 1").
 * Bump together with the notice copy: every account is asked again.
 */
export const INTEGRITY_CONSENT_NOTICE_VERSION = 1;

/** 409: the client accepted a notice version that is not the current one. */
export const INTEGRITY_CONSENT_VERSION_MISMATCH_CODE =
  'INTEGRITY_CONSENT_VERSION_MISMATCH';

/** Status of the caller's consent (both routes answer with it). */
export const integrityConsentSchema = z
  .object({
    currentVersion: z.number().int().positive(),
    /** Highest notice version the user accepted (not revoked); null = never. */
    acceptedVersion: z.number().int().positive().nullable(),
    acceptedAt: z.string().datetime().nullable(),
  })
  .strict()
  .refine(
    (consent) =>
      (consent.acceptedVersion === null) === (consent.acceptedAt === null),
    {
      message: 'acceptedVersion and acceptedAt are set together.',
      path: ['acceptedAt'],
    },
  );
export type IntegrityConsentDto = z.infer<typeof integrityConsentSchema>;

/**
 * `POST /integrity/consent` body: the notice version the user read. Only the
 * current version is accepted (409 `INTEGRITY_CONSENT_VERSION_MISMATCH`);
 * accepting it again is an idempotent 200 that keeps the original time.
 */
export const acceptIntegrityConsentInputSchema = z
  .object({
    noticeVersion: z.number().int().positive(),
  })
  .strict();
export type AcceptIntegrityConsentInput = z.infer<
  typeof acceptIntegrityConsentInputSchema
>;

/** `error.details` of `409 INTEGRITY_CONSENT_VERSION_MISMATCH`. */
export const integrityConsentVersionMismatchDetailsSchema = z
  .object({
    currentVersion: z.number().int().positive(),
  })
  .strict();
export type IntegrityConsentVersionMismatchDetails = z.infer<
  typeof integrityConsentVersionMismatchDetailsSchema
>;
