import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { VoucherFormScreen } from "../../components/VoucherFormScreen";

export const metadata: Metadata = { title: "Sửa voucher | Rescom Admin" };

export default async function AdminVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  if (!REWARDS_ENABLED) notFound();
  const { id } = await params;
  return <VoucherFormScreen id={id} />;
}
