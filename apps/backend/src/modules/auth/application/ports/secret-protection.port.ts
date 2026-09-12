export interface SecretProtectionPort {
  hashRefreshSecret(secret: string): string;
  verifyRefreshSecret(secret: string, digest: string): boolean;
  hashCsrfToken(token: string): string;
  verifyCsrfToken(token: string, digest: string): boolean;
  hashOAuthSecret(secret: string): string;
  verifyOAuthSecret(secret: string, digest: string): boolean;
  encryptPkceVerifier(verifier: string): string;
  decryptPkceVerifier(encrypted: string): string;
}

export const SECRET_PROTECTION_PORT = Symbol('SecretProtectionPort');
