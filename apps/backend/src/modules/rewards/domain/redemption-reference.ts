import { randomInt } from 'crypto';

export const REDEMPTION_REFERENCE_CHARS =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface RandomSource {
  random(): number;
}

const CRYPTO_RANDOM: RandomSource = {
  random: () => randomInt(2 ** 31) / 2 ** 31,
};

/**
 * Generates reference matching RDM-YYYY-XXXX (where XXXX is 4 chars 0-9A-Z).
 * Takes injected random source for deterministic testing.
 */
export function generateRedemptionReference(
  year: number,
  randomSource: RandomSource = CRYPTO_RANDOM,
): string {
  let chars = '';
  for (let i = 0; i < 4; i++) {
    const idx = Math.floor(
      randomSource.random() * REDEMPTION_REFERENCE_CHARS.length,
    );
    chars += REDEMPTION_REFERENCE_CHARS[idx];
  }
  return `RDM-${year}-${chars}`;
}
