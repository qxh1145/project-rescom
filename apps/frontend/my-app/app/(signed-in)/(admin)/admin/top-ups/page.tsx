import type { Metadata } from "next";
import { TopUpReviewScreen } from "./components/TopUpReviewScreen";

export const metadata: Metadata = {
  title: "Duyệt nạp điểm — Rescom Admin",
};

/** `/admin/top-ups` — Figma 11b "Duyệt nạp điểm" (63:369, desktop only). */
export default function AdminTopUpsPage() {
  return <TopUpReviewScreen />;
}
