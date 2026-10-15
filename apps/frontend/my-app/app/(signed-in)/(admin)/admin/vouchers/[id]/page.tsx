import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { VoucherDetailScreen } from "../components/VoucherDetailScreen";

export const metadata: Metadata = { title: "Chi tiết voucher | Rescom Admin" };

export default async function AdminVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  if (!REWARDS_ENABLED) notFound();
  const { id } = await params;
  return <VoucherDetailScreen id={id} />;
}
