export const COMPLETION_CODE_PORT = Symbol('COMPLETION_CODE_PORT');

export interface VerifierParts {
  keyVersion: string;
  digest: string;
}

export interface CompletionCodePort {
  generateSixDigitCode(): string;
  /**
   * Phase 5 C6: a 6-digit code derived from `seed` with the server secret, so
   * an idempotent replay of `POST /forms/external` can disclose the same code
   * again without the plaintext ever being stored.
   */
  deriveSixDigitCode(seed: string): string;
  computeVerifier(
    formVersionId: string,
    plaintextCode: string,
    keyVersion?: string,
  ): string;
  verifyCode(
    formVersionId: string,
    candidateCode: string,
    storedVerifier?: string | null,
  ): boolean;
  parseVerifier(storedVerifier?: string | null): VerifierParts | null;
  /**
   * Epic 5 review P9: whether a stored verifier can be checked at all (well
   * formed, with a configured key version). A false result means the survey
   * version cannot verify any code — never the respondent's fault.
   */
  canVerify(storedVerifier?: string | null): boolean;
}
