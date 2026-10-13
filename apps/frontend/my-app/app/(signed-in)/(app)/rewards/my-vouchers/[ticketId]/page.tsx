import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { VoucherTicketScreen } from "../../components/VoucherTicketScreen";

export const metadata: Metadata = {
  title: "Dùng voucher | Rescom",
};

interface VoucherTicketPageProps {
  params: Promise<{ ticketId: string }>;
}

export default async function VoucherTicketPage({ params }: VoucherTicketPageProps) {
  if (PILOT_BUILD) notFound();
  const { ticketId } = await params;
  return <VoucherTicketScreen ticketId={ticketId} />;
}
