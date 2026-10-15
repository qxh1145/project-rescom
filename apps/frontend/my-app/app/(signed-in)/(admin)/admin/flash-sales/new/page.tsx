import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { FlashSaleFormScreen } from "../components/FlashSaleFormScreen";

export const metadata: Metadata = { title: "Tạo Flash Sale | Rescom Admin" };
export default function NewFlashSalePage() {
  if (!REWARDS_ENABLED) notFound();
  return <FlashSaleFormScreen />;
}
