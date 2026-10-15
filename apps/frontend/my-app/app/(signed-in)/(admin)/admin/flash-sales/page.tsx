import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { FlashSalesScreen } from "./components/FlashSalesScreen";

export const metadata: Metadata = { title: "Flash Sale | Rescom Admin" };
export default function AdminFlashSalesPage() {
  if (!REWARDS_ENABLED) notFound();
  return <FlashSalesScreen />;
}
