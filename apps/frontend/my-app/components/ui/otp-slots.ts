/**
 * Pure slot logic of `OtpInput` (unit-tested in `tests/otp-slots.test.mjs`).
 *
 * The value is a fixed-length string: one character per box, a lowercase
 * letter or digit, or
 * `OTP_EMPTY_SLOT` (a space). Clearing box 2 or typing in box 4 first never
 * shifts the other digits. `""` is accepted as "all empty". The code is
 * complete — and then letters/digits only — when `isOtpComplete(value, length)`.
 */

export const OTP_EMPTY_SLOT = " ";

/** One entry per box: a letter/digit (lowercased) or `""`. */
export function otpSlots(value: string, length: number): string[] {
  return Array.from({ length }, (_, index) => {
    const char = (value[index] ?? "").toLowerCase();
    return /^[a-z0-9]$/.test(char) ? char : "";
  });
}

function joinSlots(slots: readonly string[]): string {
  return slots.map((slot) => slot || OTP_EMPTY_SLOT).join("");
}

export function isOtpComplete(value: string, length: number): boolean {
  return value.length === length && /^[a-z0-9]+$/.test(value);
}

/**
 * The box at `index` now holds `raw` (what the input reports after typing or
 * pasting). Returns the new value and the box to focus.
 * - no digit → the box is cleared (focus stays);
 * - one digit replacing an existing one (`"35"` in a box that held `3`) → `5`;
 * - a full-length paste anywhere → fills every box from the first;
 * - otherwise the digits fill this box and the following ones.
 */
export function typeIntoOtp(
  value: string,
  length: number,
  index: number,
  raw: string,
): { value: string; focus: number } {
  const slots = otpSlots(value, length);
  let digits = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!digits) {
    slots[index] = "";
    return { value: joinSlots(slots), focus: index };
  }
  const previous = slots[index];
  if (previous && digits.length === 2) digits = digits[0] === previous ? digits[1] : digits[0];

  const start = digits.length >= length ? 0 : index;
  const written = Math.min(digits.length, length - start);
  for (let offset = 0; offset < written; offset += 1) slots[start + offset] = digits[offset];
  return { value: joinSlots(slots), focus: Math.min(start + written, length - 1) };
}
