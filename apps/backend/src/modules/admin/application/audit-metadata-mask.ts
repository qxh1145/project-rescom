const DENY_LIST = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'resettoken',
  'tokenhash',
  'secret',
  'otp',
  'cookie',
  'authorization',
]);

const BANK_KEYS = new Set([
  'accountnumber',
  'bankaccount',
  'bankaccountnumber',
]);

export const MASKED_PLACEHOLDER = '[ĐÃ ẨN]';

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

// Review 14.3: also catch variants such as `currentPassword`, `clientSecret`,
// `refreshTokenHash`, `bankAccountNo`. Opaque ids (`tokenId`) do not match.
const DENY_SUFFIXES = ['password', 'secret', 'tokenhash'];
const BANK_SUFFIXES = ['accountno', 'accountnumber'];

function isDenied(norm: string): boolean {
  return DENY_LIST.has(norm) || DENY_SUFFIXES.some((s) => norm.endsWith(s));
}

function isBankKey(norm: string): boolean {
  return BANK_KEYS.has(norm) || BANK_SUFFIXES.some((s) => norm.endsWith(s));
}

/**
 * Pure metadata masking helper (AC 7).
 * Deny-listed keys are replaced with "[ĐÃ ẨN]".
 * Bank account keys keep only the last 4 digits ("••••1234") or "[ĐÃ ẨN]" if fewer than 4 digits.
 * Recursively applied to objects and arrays. Never mutates input.
 */
export function maskAuditMetadata<T>(metadata: T): T {
  if (metadata === null || metadata === undefined) {
    return metadata;
  }

  if (Array.isArray(metadata)) {
    return metadata.map((item) => maskAuditMetadata(item)) as unknown as T;
  }

  if (typeof metadata === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      metadata as Record<string, unknown>,
    )) {
      const norm = normalizeKey(key);
      if (isDenied(norm)) {
        result[key] = MASKED_PLACEHOLDER;
      } else if (isBankKey(norm)) {
        if (typeof value === 'string' || typeof value === 'number') {
          const digits = String(value).replace(/\D/g, '');
          result[key] =
            digits.length >= 4 ? `••••${digits.slice(-4)}` : MASKED_PLACEHOLDER;
        } else {
          result[key] = MASKED_PLACEHOLDER;
        }
      } else {
        result[key] = maskAuditMetadata(value);
      }
    }
    return result as unknown as T;
  }

  return metadata;
}
