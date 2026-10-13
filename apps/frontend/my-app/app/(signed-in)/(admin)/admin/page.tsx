import type { Metadata } from "next";
import { OverviewScreen } from "./components/OverviewScreen";

export const metadata: Metadata = {
  title: "Tổng quan | Rescom Admin",
};

/** `/admin` — Figma 11 "Tổng quan" (62:4070, desktop only). */
export default function AdminOverviewPage() {
  return <OverviewScreen />;
}
