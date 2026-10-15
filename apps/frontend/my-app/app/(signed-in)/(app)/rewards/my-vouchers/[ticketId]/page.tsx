import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { VoucherTicketScreen } from "../../components/VoucherTicketScreen";

export const metadata: Metadata = {
  title: "Dùng voucher | Rescom",
};

interface VoucherTicketPageProps {
  params: Promise<{ ticketId: string }>;
}

export default async function VoucherTicketPage({ params }: VoucherTicketPageProps) {
  if (!REWARDS_ENABLED) notFound();
  const { ticketId } = await params;
  return <VoucherTicketScreen ticketId={ticketId} />;
}
