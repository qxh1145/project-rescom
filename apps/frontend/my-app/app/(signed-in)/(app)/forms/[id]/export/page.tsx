import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { ExportDialog } from "./components/ExportDialog";

export const metadata: Metadata = {
  title: "Xuất câu trả lời | Rescom",
};

/**
 * `/forms/:id/export[?v=1]` — Figma 10e "Xuất .xlsx / .csv" (62:3771 desktop
 * modal, 62:3932 mobile sheet). "Đóng"/"Huỷ" go back to the responses tab.
 * The file is generated in the browser (see `lib/forms/results-export.ts`).
 */
export default function FormExportPage() {
  if (PILOT_BUILD) notFound();
  return (
    <Suspense>
      <ExportDialog />
    </Suspense>
  );
}
