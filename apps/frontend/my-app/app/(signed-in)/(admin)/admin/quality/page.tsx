import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { QualityScreen } from "./components/QualityScreen";

export const metadata: Metadata = {
  title: "Xem xét chất lượng | Rescom Admin",
};

/** `/admin/quality[?id=<responseId>]` — Figma 17b "Admin · Xét chất lượng câu trả lời" (63:3276). */
export default function AdminQualityPage() {
  if (PILOT_BUILD) notFound();
  return <QualityScreen />;
}
