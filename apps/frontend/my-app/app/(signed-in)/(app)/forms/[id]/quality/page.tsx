import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { QualityScreen } from "./components/QualityScreen";

export const metadata: Metadata = {
  title: "Chất lượng khảo sát | Rescom",
};

/**
 * `/forms/:id/quality[?v=1]` — Figma 17 "Đánh giá chất lượng khảo sát"
 * (63:4702 desktop; mobile ASSUMED: tiles 2×2, sections stacked).
 */
export default function FormQualityPage() {
  if (PILOT_BUILD) notFound();
  return (
    <Suspense>
      <QualityScreen />
    </Suspense>
  );
}
