export const COMPLETION_CODE_PORT = Symbol('COMPLETION_CODE_PORT');

export interface VerifierParts {
  keyVersion: string;
  digest: string;
}

export interface CompletionCodePort {
  generateSixDigitCode(): string;
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
