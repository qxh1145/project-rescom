interface SpinnerProps {
  className?: string;
}

/** Decorative; pair it with visible text or `aria-busy` on the owner. */
export function Spinner({ className = "size-4" }: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
