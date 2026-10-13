import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { VoucherStatsScreen } from "./components/VoucherStatsScreen";

export const metadata: Metadata = { title: "Thống kê voucher | Rescom Admin" };
export default function VoucherStatsPage() {
  if (PILOT_BUILD) notFound();
  return <VoucherStatsScreen />;
}
