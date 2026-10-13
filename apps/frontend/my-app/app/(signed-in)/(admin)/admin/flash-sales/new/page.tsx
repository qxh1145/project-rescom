import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { FlashSaleFormScreen } from "../components/FlashSaleFormScreen";

export const metadata: Metadata = { title: "Tạo Flash Sale | Rescom Admin" };
export default function NewFlashSalePage() {
  if (PILOT_BUILD) notFound();
  return <FlashSaleFormScreen />;
}
