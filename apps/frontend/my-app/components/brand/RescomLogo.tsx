import Image from "next/image";

type RescomLogoSize = "xs" | "sm" | "base" | "md" | "lg";

/**
 * Heights from Figma (asset 480×103): xs 22 (onboarding), sm 24 (mobile app bar),
 * base 28 (onboarding welcome, mobile 63:5185), md 30, lg 40.
 */
const SIZE_CLASSES: Record<RescomLogoSize, string> = {
  xs: "h-5.5 w-auto",
  sm: "h-6 w-auto",
  base: "h-7 w-auto",
  md: "h-7.5 w-auto",
  lg: "h-10 w-auto",
};

interface RescomLogoProps {
  size?: RescomLogoSize;
  /** Above-the-fold. Uses fetchPriority, not `preload`, since each breakpoint renders its own logo. */
  highPriority?: boolean;
}

export function RescomLogo({ size = "lg", highPriority = false }: RescomLogoProps) {
  return (
    <Image
      src="/brand/rescom-logo.png"
      alt="Rescom"
      width={480}
      height={103}
      fetchPriority={highPriority ? "high" : undefined}
      className={SIZE_CLASSES[size]}
    />
  );
}
