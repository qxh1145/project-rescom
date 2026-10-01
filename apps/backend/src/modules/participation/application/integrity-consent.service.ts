import {
  INTEGRITY_CONSENT_NOTICE_VERSION,
  INTEGRITY_CONSENT_PURPOSE,
  type AcceptIntegrityConsentInput,
  type IntegrityConsentDto,
} from '@rescom/schemas';
import {
  IntegrityConsentRecord,
  IntegrityConsentRepositoryPort,
} from './ports/integrity-consent-repository.port';
import { IntegrityConsentVersionMismatchException } from './exceptions/integrity-consent.exceptions';

export interface IntegrityConsentServiceDeps {
  repository: IntegrityConsentRepositoryPort;
  /** The notice version in force (default `INTEGRITY_CONSENT_NOTICE_VERSION`). */
  currentNoticeVersion?: number;
  now?: () => Date;
}

/**
 * Integrity telemetry notice (Figma 14): the caller's acceptance, kept per
 * notice version in `IntegrityConsent` (AD-9: telemetry carries the consent
 * purpose and notice version). The notice is shown again only when its
 * version changes; only the version in force can be accepted.
 */
export class IntegrityConsentService {
  private readonly repository: IntegrityConsentRepositoryPort;
  private readonly currentNoticeVersion: number;
  private readonly now: () => Date;

  constructor(deps: IntegrityConsentServiceDeps) {
    this.repository = deps.repository;
    this.currentNoticeVersion =
      deps.currentNoticeVersion ?? INTEGRITY_CONSENT_NOTICE_VERSION;
    this.now = deps.now ?? (() => new Date());
  }

  async getConsent(userId: string): Promise<IntegrityConsentDto> {
    const accepted = await this.repository.findLatestAccepted(
      userId,
      INTEGRITY_CONSENT_PURPOSE,
    );
    return this.toDto(accepted);
  }

  /**
   * Accepting the version in force again is an idempotent 200 that keeps the
   * original acceptance time.
   */
  async acceptConsent(
    userId: string,
    input: AcceptIntegrityConsentInput,
  ): Promise<IntegrityConsentDto> {
    if (input.noticeVersion !== this.currentNoticeVersion) {
      throw new IntegrityConsentVersionMismatchException(
        this.currentNoticeVersion,
      );
    }
    const accepted = await this.repository.accept({
      userId,
      purpose: INTEGRITY_CONSENT_PURPOSE,
      noticeVersion: input.noticeVersion,
      grantedAt: this.now(),
    });
    return this.toDto(accepted);
  }

  private toDto(accepted: IntegrityConsentRecord | null): IntegrityConsentDto {
    return {
      currentVersion: this.currentNoticeVersion,
      acceptedVersion: accepted?.noticeVersion ?? null,
      acceptedAt: accepted ? accepted.grantedAt.toISOString() : null,
    };
  }
}
