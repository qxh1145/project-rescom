import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { RedemptionHistoryScreen } from "../components/RedemptionHistoryScreen";

export const metadata: Metadata = {
  title: "Lịch sử đổi điểm | Rescom",
};

export default function RedemptionHistoryPage() {
  if (!REWARDS_ENABLED) notFound();
  return <RedemptionHistoryScreen />;
}
