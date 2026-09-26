import { Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { EnvService } from '../../../common/config/env.service';
import {
  CompletionCodePort,
  VerifierParts,
} from '../application/ports/completion-code.port';

export { VerifierParts };

/** The only verifier key version currently configured (single-key ring). */
export const CURRENT_COMPLETION_CODE_KEY_VERSION = 'v1';

const MIN_SECRET_LENGTH = 32;

@Injectable()
export class CompletionCodeService implements CompletionCodePort {
  private readonly secretKey: string;

  /**
   * Key precedence (Story 4.5 AC2.3): `COMPLETION_CODE_HMAC_SECRET`, then
   * `JWT_SECRET` (via EnvService when injected, else `process.env`). There is
   * no hard-coded fallback: a missing or short key fails fast.
   */
  constructor(@Optional() envService?: EnvService) {
    const secret =
      envService?.completionCodeHmacSecret ||
      envService?.jwtSecret ||
      process.env.COMPLETION_CODE_HMAC_SECRET ||
      process.env.JWT_SECRET;
    if (!secret || secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `Completion code HMAC secret is missing or shorter than ${MIN_SECRET_LENGTH} characters (set COMPLETION_CODE_HMAC_SECRET or JWT_SECRET)`,
      );
    }
    this.secretKey = secret;
  }

  /**
   * Generates a cryptographically secure 6-digit numeric completion code.
   * Range: 100000 to 999999 inclusive.
   */
  generateSixDigitCode(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Computes a keyed HMAC verifier bound to the exact FormVersion ID.
   * Format: `${keyVersion}:${hexDigest}`.
   *
   * Note: The plaintext code must NEVER be persisted directly.
   */
  computeVerifier(
    formVersionId: string,
    plaintextCode: string,
    keyVersion = CURRENT_COMPLETION_CODE_KEY_VERSION,
  ): string {
    const payload = `${formVersionId}:${plaintextCode.trim()}`;
    const digest = crypto
      .createHmac('sha256', this.secretKey)
      .update(payload)
      .digest('hex');
    return `${keyVersion}:${digest}`;
  }

  /**
   * Parses a stored verifier into its keyVersion and digest parts.
   */
  parseVerifier(storedVerifier?: string | null): VerifierParts | null {
    if (!storedVerifier || typeof storedVerifier !== 'string') {
      return null;
    }
    const colonIndex = storedVerifier.indexOf(':');
    if (colonIndex <= 0 || colonIndex === storedVerifier.length - 1) {
      return null;
    }
    return {
      keyVersion: storedVerifier.substring(0, colonIndex),
      digest: storedVerifier.substring(colonIndex + 1),
    };
  }

  /**
   * Epic 5 review P9: a verifier is usable only when it parses, names the
   * configured key version and carries a SHA-256 hex digest. A null, legacy
   * or foreign-key verifier can never match, so callers must not charge the
   * respondent a strike for it.
   */
  canVerify(storedVerifier?: string | null): boolean {
    const parsed = this.parseVerifier(storedVerifier);
    return (
      parsed !== null &&
      parsed.keyVersion === CURRENT_COMPLETION_CODE_KEY_VERSION &&
      /^[0-9a-f]{64}$/i.test(parsed.digest)
    );
  }

  /**
   * Validates a candidate completion code against a stored keyed verifier
   * using constant-time comparison (crypto.timingSafeEqual) to prevent timing attacks.
   *
   * Plaintext code inputs are strictly NOT logged.
   */
  verifyCode(
    formVersionId: string,
    candidateCode: string,
    storedVerifier?: string | null,
  ): boolean {
    if (!storedVerifier || !candidateCode) {
      return false;
    }

    const trimmedCandidate = candidateCode.trim();
    if (!/^\d{6}$/.test(trimmedCandidate)) {
      return false;
    }

    const parsed = this.parseVerifier(storedVerifier);
    if (!parsed) {
      return false;
    }
    // `keyVersion` must select a configured key. Only the current key exists
    // (no multi-key ring yet), so any other version can never verify — it must
    // not be HMAC-ed with the current key under a different label.
    if (parsed.keyVersion !== CURRENT_COMPLETION_CODE_KEY_VERSION) {
      return false;
    }

    const expectedVerifier = this.computeVerifier(
      formVersionId,
      trimmedCandidate,
      parsed.keyVersion,
    );
    const expectedDigest = expectedVerifier.split(':')[1];

    const actualBuf = Buffer.from(parsed.digest, 'hex');
    const expectedBuf = Buffer.from(expectedDigest, 'hex');

    if (actualBuf.length !== expectedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(actualBuf, expectedBuf);
  }
}
