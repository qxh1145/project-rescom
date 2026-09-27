import type { Metadata } from "next";
import { ComplaintScreen } from "./components/ComplaintScreen";

export const metadata: Metadata = {
  title: "Khiếu nại lượt làm — Rescom",
};

/** `/forms/:id/complaints/:attemptId` — Figma 10c "Khiếu nại lượt làm" (62:1720) over the Tiến độ tab. */
export default function ComplaintPage() {
  return <ComplaintScreen />;
}
