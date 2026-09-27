/**
 * Register password meter (Figma 63:3448–63:3452: 4 segments + "Khá mạnh · 16 ký tự…").
 *
 * The backend only enforces ≥ 12 characters (graphemes) and ≤ 72 UTF-8 bytes
 * (`registerPasswordSchema`). The levels below are an ASSUMED client-side hint —
 * length first (a long passphrase beats symbol soup), variety second. They
 * never block submission; the shared zod schema does.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** 0 = empty, 1 = too short, 2 = acceptable, 3 = fairly strong, 4 = very strong. */
export type PasswordStrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface PasswordStrength {
  level: PasswordStrengthLevel;
  /** Grapheme count, same unit as the backend minimum. */
  length: number;
  /** Empty for level 0. */
  label: string;
}

export const PASSWORD_STRENGTH_LABELS: Record<PasswordStrengthLevel, string> = {
  0: "",
  1: "Quá ngắn",
  2: "Tạm được",
  3: "Khá mạnh",
  4: "Rất mạnh",
};

export const PASSWORD_GUIDANCE = "Ít nhất 12 ký tự; một cụm từ dài dễ nhớ sẽ an toàn hơn.";

const segmenter = new Intl.Segmenter("vi", { granularity: "grapheme" });

function graphemes(value: string): string[] {
  return Array.from(segmenter.segment(value), (part) => part.segment);
}

/** Lower-case, upper-case, digit, anything else (space, punctuation, accents). */
function characterClasses(value: string): number {
  return [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) => pattern.test(value)).length;
}

export function scorePassword(password: string): PasswordStrength {
  const chars = graphemes(password);
  const length = chars.length;
  const make = (level: PasswordStrengthLevel): PasswordStrength => ({
    level,
    length,
    label: PASSWORD_STRENGTH_LABELS[level],
  });

  if (length === 0) return make(0);
  if (length < MIN_PASSWORD_LENGTH) return make(1);

  // "aaaaaaaaaaaa" / "abcabcabcabc" pass the length rule but are trivially guessable.
  if (new Set(chars.map((char) => char.toLowerCase())).size < 5) return make(2);

  const classes = characterClasses(password);
  if (length >= 24 || (length >= 16 && classes >= 3)) return make(4);
  if (length >= 16 || classes >= 3) return make(3);
  return make(2);
}

/** "Khá mạnh · 16 ký tự. Ít nhất 12 ký tự; …" — the guidance alone while empty. */
export function describePasswordStrength(strength: PasswordStrength): {
  label: string;
  detail: string;
} {
  if (strength.level === 0) return { label: "", detail: PASSWORD_GUIDANCE };
  return { label: strength.label, detail: ` · ${strength.length} ký tự. ${PASSWORD_GUIDANCE}` };
}
