import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { VoucherStatsScreen } from "./components/VoucherStatsScreen";

export const metadata: Metadata = { title: "Thống kê voucher | Rescom Admin" };
export default function VoucherStatsPage() {
  if (!REWARDS_ENABLED) notFound();
  return <VoucherStatsScreen />;
}
