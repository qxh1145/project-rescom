import type { Metadata } from "next";
import { VersionsScreen } from "./components/VersionsScreen";

export const metadata: Metadata = {
  title: "Lịch sử phiên bản | Rescom",
};

/**
 * `/forms/:id/versions` — Figma 17a "Lịch sử phiên bản" (63:5939 desktop;
 * mobile ASSUMED: cards stacked, the explainer after them).
 */
export default function FormVersionsPage() {
  return <VersionsScreen />;
}
