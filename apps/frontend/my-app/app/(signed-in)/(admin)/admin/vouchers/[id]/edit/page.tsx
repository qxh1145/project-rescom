import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { VoucherFormScreen } from "../../components/VoucherFormScreen";

export const metadata: Metadata = { title: "Sửa voucher | Rescom Admin" };

export default async function AdminVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  if (PILOT_BUILD) notFound();
  const { id } = await params;
  return <VoucherFormScreen id={id} />;
}
