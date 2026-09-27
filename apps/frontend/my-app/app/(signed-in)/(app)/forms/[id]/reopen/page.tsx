import type { Metadata } from "next";
import { ReopenScreen } from "./components/ReopenScreen";

export const metadata: Metadata = {
  title: "Mở lại khảo sát — Rescom",
};

/** `/forms/:id/reopen` — Figma 10b "Mở lại khảo sát" over the Tiến độ tab (63:1392 / 63:1843). */
export default function ReopenPage() {
  return <ReopenScreen />;
}
