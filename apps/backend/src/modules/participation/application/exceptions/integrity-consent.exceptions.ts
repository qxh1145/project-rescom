import { INTEGRITY_CONSENT_VERSION_MISMATCH_CODE } from '@rescom/schemas';

/**
 * The client accepted a notice version that is not the one in force (a stale
 * page, or a version that does not exist). Recording it would let a future
 * notice look accepted, so it is refused (409); `currentVersion` tells the
 * client which notice to show again.
 */
export class IntegrityConsentVersionMismatchException extends Error {
  readonly code = INTEGRITY_CONSENT_VERSION_MISMATCH_CODE;

  constructor(
    public readonly currentVersion: number,
    message = `Only the current integrity notice (version ${currentVersion}) can be accepted.`,
  ) {
    super(message);
    this.name = 'IntegrityConsentVersionMismatchException';
  }
}
