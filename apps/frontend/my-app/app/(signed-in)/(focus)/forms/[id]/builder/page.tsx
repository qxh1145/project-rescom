import { Suspense } from "react";
import type { Metadata } from "next";
import { BuilderScreen } from "./components/BuilderScreen";

export const metadata: Metadata = {
  title: "Soạn form — Rescom",
};

/**
 * Figma page 13 "Người đăng – Form Builder kéo thả" (63:4221, 72:78, 63:690;
 * mobile 69:78, 63:1229). Preview at `/forms/:id/builder/preview`, AI chat at
 * `/forms/:id/builder/ai`, steps 2–3 at `/forms/:id/builder/publish`.
 */
export default function FormBuilderPage() {
  return (
    <Suspense>
      <BuilderScreen />
    </Suspense>
  );
}
