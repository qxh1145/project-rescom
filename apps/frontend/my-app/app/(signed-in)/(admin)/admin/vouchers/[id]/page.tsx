import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { VoucherDetailScreen } from "../components/VoucherDetailScreen";

export const metadata: Metadata = { title: "Chi tiết voucher | Rescom Admin" };

export default async function AdminVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  if (PILOT_BUILD) notFound();
  const { id } = await params;
  return <VoucherDetailScreen id={id} />;
}
