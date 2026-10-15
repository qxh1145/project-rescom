import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { VouchersScreen } from "./components/VouchersScreen";

export const metadata: Metadata = { title: "Voucher | Rescom Admin" };

export default function AdminVoucherPage() {
  if (!REWARDS_ENABLED) notFound();
  return <VouchersScreen />;
}
