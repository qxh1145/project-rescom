import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/** Loading line shared by the page-16 screens (same pattern as /account/trust). */
export function LoadingStatus({ className = "" }: { className?: string }) {
  return (
    <p className={`flex items-center gap-3 py-10 text-body text-ink-muted ${className}`} role="status">
      <Spinner className="size-5 text-primary" />
      Đang tải…
    </p>
  );
}

/** Inline load failure with a retry. */
export function ErrorStatus({ message, onRetry, className = "" }: { message: string; onRetry: () => void; className?: string }) {
  return (
    <Alert tone="danger" className={className}>
      {message}{" "}
      <Button variant="ghost" size="sm" className="-my-2 inline-flex" onClick={onRetry}>
        Thử lại
      </Button>
    </Alert>
  );
}
