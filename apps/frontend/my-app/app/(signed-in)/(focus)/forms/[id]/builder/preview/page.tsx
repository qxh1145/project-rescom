import { Suspense } from "react";
import type { Metadata } from "next";
import { PreviewScreen } from "./components/PreviewScreen";

export const metadata: Metadata = {
  title: "Xem trước khảo sát — Rescom",
};

/** Figma 13d "Xem trước + dữ liệu chất lượng" (63:4901). */
export default function FormBuilderPreviewPage() {
  return (
    <Suspense>
      <PreviewScreen />
    </Suspense>
  );
}
