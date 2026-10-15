import { Button, ButtonLink } from "@/components/ui/Button";

interface RewardsErrorStateProps {
  onRetry: () => void;
  /** Defaults to the voucher-list copy (Story 12.2). */
  title?: string;
}

export function RewardsErrorState({ onRetry, title = "Chưa tải được danh sách voucher" }: RewardsErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {/* Offline mascot */}
      <div className="relative mb-3 h-28 w-28">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mascots/offline.svg" alt="" className="h-full w-full object-contain" />
      </div>

      <h3 className="text-title-sm font-bold text-ink">{title}</h3>
      <p className="mt-1 text-body text-ink-muted max-w-md">
        Kết nối đang chập chờn. Điểm và voucher của bạn vẫn an toàn — thử lại sau vài giây nhé.
      </p>

      <div className="mt-5 flex items-center gap-3">
        <Button variant="primary" size="md" onClick={onRetry}>
          Thử lại
        </Button>
        <ButtonLink variant="secondary" size="md" href="/wallet">
          Về Ví điểm
        </ButtonLink>
      </div>
    </div>
  );
}
