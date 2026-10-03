import {
  describePasswordStrength,
  scorePassword,
  type PasswordStrengthLevel,
} from "@/lib/auth/password-strength";

/** Level → segment fill and label color. Only "Khá mạnh" (green) is drawn in Figma; others ASSUMED (design). */
const TONES: Record<PasswordStrengthLevel, { bar: string; label: string }> = {
  0: { bar: "bg-line", label: "" },
  1: { bar: "bg-danger", label: "text-danger" },
  2: { bar: "bg-tone-amber-fg", label: "text-tone-amber-fg" },
  3: { bar: "bg-primary", label: "text-tone-green-fg" },
  4: { bar: "bg-primary", label: "text-tone-green-fg" },
};

const SEGMENTS = [1, 2, 3, 4] as const;

interface PasswordStrengthMeterProps {
  /** id of the helper text, referenced by the password input's `aria-describedby`. */
  id: string;
  password: string;
}

/** Figma `63:3448`–`63:3452`: four 6px segments + "Khá mạnh · 16 ký tự. …" helper. */
export function PasswordStrengthMeter({ id, password }: PasswordStrengthMeterProps) {
  const strength = scorePassword(password);
  const { label, detail } = describePasswordStrength(strength);
  const tone = TONES[strength.level];

  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="grid grid-cols-4 gap-1">
        {SEGMENTS.map((segment) => (
          <span
            key={segment}
            className={`h-1.5 rounded-full ${segment <= strength.level ? tone.bar : "bg-line"}`}
          />
        ))}
      </div>
      <p id={id} className="text-caption text-ink-muted">
        {label ? <span className={`font-bold ${tone.label}`}>{label}</span> : null}
        {detail}
      </p>
    </div>
  );
}
