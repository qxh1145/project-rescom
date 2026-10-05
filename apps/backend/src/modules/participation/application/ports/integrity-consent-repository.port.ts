export const INTEGRITY_CONSENT_REPOSITORY_PORT = Symbol(
  'INTEGRITY_CONSENT_REPOSITORY_PORT',
);

/** One accepted notice version of a user (`IntegrityConsent` row). */
export interface IntegrityConsentRecord {
  id: string;
  userId: string;
  purpose: string;
  noticeVersion: number;
  grantedAt: Date;
  revokedAt: Date | null;
}

export interface AcceptIntegrityConsentParams {
  userId: string;
  purpose: string;
  noticeVersion: number;
  grantedAt: Date;
}

/**
 * Integrity-owned consent records (AD-9/AD-16), hosted by the Participation
 * module next to the behavioural `IntegrityEvent` writes. One row per user,
 * purpose and notice version.
 */
export interface IntegrityConsentRepositoryPort {
  /** The user's highest accepted (not revoked) notice version for `purpose`. */
  findLatestAccepted(
    userId: string,
    purpose: string,
  ): Promise<IntegrityConsentRecord | null>;

  /**
   * Records the acceptance idempotently: an existing acceptance of the same
   * version is returned unchanged (original `grantedAt`) and concurrent calls
   * converge on one row; a revoked one is granted again.
   */
  accept(params: AcceptIntegrityConsentParams): Promise<IntegrityConsentRecord>;
}
