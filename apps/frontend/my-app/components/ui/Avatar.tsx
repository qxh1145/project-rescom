interface AvatarProps {
  initials: string;
  /** 38 (lists), 40 (header), 60 (account card). */
  size?: 38 | 40 | 60;
  className?: string;
}

/** Initials on brand green (Figma "Link – Tài khoản"). Decorative next to a visible name. */
export function Avatar({ initials, size = 40, className = "" }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand font-extrabold text-ink ${className}`}
      style={{ width: size, height: size, fontSize: size >= 60 ? 20 : 14 }}
    >
      {initials}
    </span>
  );
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  // Vietnamese names put the given name last: "Linh Nguyễn" → LN, "Nguyễn Thị Linh" → NL.
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}
