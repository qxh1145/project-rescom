import { Injectable, Optional } from '@nestjs/common';
import * as crypto from 'crypto';
import { EnvService } from '../../../common/config/env.service';
import {
  CompletionCodePort,
  VerifierParts,
} from '../application/ports/completion-code.port';

export { VerifierParts };

@Injectable()
export class CompletionCodeService implements CompletionCodePort {
  private readonly secretKey: string;

  constructor(@Optional() envService?: EnvService) {
    this.secretKey =
      envService?.jwtSecret ||
      process.env.COMPLETION_CODE_SECRET ||
      process.env.JWT_SECRET ||
      'rescom_completion_code_secret_key_at_least_32_chars!';
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
    keyVersion = 'v1',
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
