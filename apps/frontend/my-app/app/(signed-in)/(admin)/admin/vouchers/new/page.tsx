import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { VoucherFormScreen } from "../components/VoucherFormScreen";

export const metadata: Metadata = { title: "Tạo voucher | Rescom Admin" };

export default function AdminVoucherPage() {
  if (PILOT_BUILD) notFound();
  return <VoucherFormScreen />;
}
