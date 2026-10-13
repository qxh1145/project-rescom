import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { RedemptionHistoryScreen } from "../components/RedemptionHistoryScreen";

export const metadata: Metadata = {
  title: "Lịch sử đổi điểm | Rescom",
};

export default function RedemptionHistoryPage() {
  if (PILOT_BUILD) notFound();
  return <RedemptionHistoryScreen />;
}
