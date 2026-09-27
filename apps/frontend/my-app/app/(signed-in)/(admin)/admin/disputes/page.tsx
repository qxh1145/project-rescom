import type { Metadata } from "next";
import { DisputesScreen } from "./components/DisputesScreen";

export const metadata: Metadata = {
  title: "Khiếu nại & báo lỗi — Rescom Admin",
};

/** `/admin/disputes` — Figma 11c "Khiếu nại & báo lỗi" (62:1609). */
export default function AdminDisputesPage() {
  return <DisputesScreen />;
}
