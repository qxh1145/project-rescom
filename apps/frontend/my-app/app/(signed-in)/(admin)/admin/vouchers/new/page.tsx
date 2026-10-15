import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { VoucherFormScreen } from "../components/VoucherFormScreen";

export const metadata: Metadata = { title: "Tạo voucher | Rescom Admin" };

export default function AdminVoucherPage() {
  if (!REWARDS_ENABLED) notFound();
  return <VoucherFormScreen />;
}
