import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { VoucherDetailScreen } from "../components/VoucherDetailScreen";

export const metadata: Metadata = {
  title: "Chi tiết voucher | Rescom",
};

interface VoucherDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function VoucherDetailPage({ params }: VoucherDetailPageProps) {
  if (PILOT_BUILD) notFound();
  const { id } = await params;
  return <VoucherDetailScreen voucherId={id} />;
}
