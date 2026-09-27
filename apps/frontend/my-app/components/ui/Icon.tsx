import type { CSSProperties } from "react";

/**
 * Monochrome UI icon exported from Figma into `public/icons/<name>.svg`.
 *
 * The SVG is used as a CSS mask so its exact shape renders in `currentColor`:
 * set the color with a text utility (`text-primary`) to match the Figma layer.
 * Multi-color artwork (mascots, logo) must use `<img>` instead.
 */
export type IconName =
  | "bell"
  | "check"
  | "compass"
  | "file-text"
  | "loader"
  | "lock"
  | "points-coin"
  | "star-empty"
  | "star-filled"
  | "user"
  | "wallet"
  // Added per phase as screens need them — keep sorted.
  | (string & {});

interface IconProps {
  name: IconName;
  /** Rendered box in px (Figma icon frame size). */
  size?: number;
  className?: string;
  /** Meaningful icons need a label; decorative ones (default) are hidden from AT. */
  label?: string;
}

export function Icon({ name, size = 20, className = "", label }: IconProps) {
  const url = `url("/icons/${name}.svg")`;
  const style: CSSProperties = {
    width: size,
    height: size,
    maskImage: url,
    WebkitMaskImage: url,
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
  };
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`inline-block shrink-0 bg-current ${className}`}
      style={style}
    />
  );
}
