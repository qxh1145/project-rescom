"use client";

import { useWalletTopUpMode } from "@/lib/wallet/use-wallet-top-up-mode";
import { ChoosePackageScreen } from "./ChoosePackageScreen";
import { PayosCheckoutScreen } from "./PayosCheckoutScreen";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

export function TopUpEntry() {
  const { mode, reload } = useWalletTopUpMode();

  if (mode === "loading") {
    return (
      <div
        role="status"
        aria-label="Đang tải cổng nạp điểm..."
        className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-8 text-caption text-ink-muted"
      >
        <Spinner className="size-6 text-primary" />
        <span>Đang kiểm tra phương thức nạp…</span>
      </div>
    );
  }

  if (mode === "error") {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 p-8">
        <Alert tone="danger">
          Không thể kiểm tra phương thức nạp điểm lúc này. Vui lòng thử lại.
        </Alert>
        <Button variant="secondary" size="base" radius="field" onClick={reload}>
          Thử lại
        </Button>
      </div>
    );
  }

  if (mode === "manual") {
    return <ChoosePackageScreen />;
  }

  return <PayosCheckoutScreen />;
}
