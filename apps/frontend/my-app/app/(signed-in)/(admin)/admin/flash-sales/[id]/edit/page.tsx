import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { FlashSaleFormScreen } from "../../components/FlashSaleFormScreen";

export const metadata: Metadata = { title: "Sửa Flash Sale | Rescom Admin" };
export default async function EditFlashSalePage({ params }: { params: Promise<{ id: string }> }) {
  if (PILOT_BUILD) notFound();
  const { id } = await params;
  return <FlashSaleFormScreen id={id} />;
}
