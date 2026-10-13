"use client";

import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { RedemptionHistory } from "./RedemptionHistory";

export function RedemptionHistoryScreen() {
  return (
    <div className="min-h-full pb-24 lg:pb-12">
      <MobileBackBar title="Lịch sử đổi điểm" backHref="/rewards/my-vouchers" />
      <main className="mx-auto max-w-[960px] px-4 py-4 md:px-6 md:py-6 lg:px-8"><RedemptionHistory heading="h1" /></main>
    </div>
  );
}
