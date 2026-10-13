import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { FlashSalesScreen } from "./components/FlashSalesScreen";

export const metadata: Metadata = { title: "Flash Sale | Rescom Admin" };
export default function AdminFlashSalesPage() {
  if (PILOT_BUILD) notFound();
  return <FlashSalesScreen />;
}
