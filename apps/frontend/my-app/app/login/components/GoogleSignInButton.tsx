import { ButtonLink } from "@/components/ui/Button";
import { getGoogleSignInUrl } from "@/lib/api/config";

interface GoogleSignInButtonProps {
  returnTo: string | null;
  disabled?: boolean;
  /**
   * `primary`: login (`62:142`, green 52px). `secondary`: register (`63:3435`,
   * white 54px with a bordered "G" badge).
   */
  variant?: "primary" | "secondary";
}

/** Full-page navigation to the backend OAuth start (or the mock callback in mock mode). */
export function GoogleSignInButton({
  returnTo,
  disabled = false,
  variant = "primary",
}: GoogleSignInButtonProps) {
  const secondary = variant === "secondary";
  return (
    <ButtonLink
      href={getGoogleSignInUrl(returnTo)}
      variant={variant}
      size={secondary ? "xl" : "lg"}
      fullWidth
      disabled={disabled}
      leadingIcon={
        <span
          aria-hidden="true"
          className={`inline-flex items-center justify-center rounded-full bg-surface text-label font-extrabold text-primary ${
            secondary ? "size-6.5 border border-line" : "size-6"
          }`}
        >
          G
        </span>
      }
    >
      Tiếp tục với Google
    </ButtonLink>
  );
}
