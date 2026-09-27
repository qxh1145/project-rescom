import type { Metadata } from "next";
import { PendingScreen } from "../../components/PendingScreen";

export const metadata: Metadata = {
  title: "Yêu cầu nạp điểm — Rescom",
};

/** `/wallet/top-up/:id/pending` — Figma 14c "chờ duyệt" (62:2968 desktop, 62:3154 mobile). */
export default function TopUpStatusPage() {
  return <PendingScreen />;
}
