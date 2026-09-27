import type { Metadata } from "next";
import { ProgressScreen } from "./components/ProgressScreen";

export const metadata: Metadata = {
  title: "Theo dõi khảo sát — Rescom",
};

/** `/forms/:id` — "Tiến độ" tab, Figma 10a "Theo dõi khảo sát" (62:2565 desktop, 62:3292 mobile). */
export default function FormProgressPage() {
  return <ProgressScreen />;
}
