import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { VouchersScreen } from "./components/VouchersScreen";

export const metadata: Metadata = { title: "Voucher | Rescom Admin" };

export default function AdminVoucherPage() {
  if (PILOT_BUILD) notFound();
  return <VouchersScreen />;
}
