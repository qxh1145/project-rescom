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
}
