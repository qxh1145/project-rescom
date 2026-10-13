import { Suspense } from "react";
import type { Metadata } from "next";
import { CompleteScreen } from "./components/CompleteScreen";

export const metadata: Metadata = {
  title: "Hoàn thành khảo sát | Rescom",
};

/**
 * Figma page 6 "Hoàn thành & đánh giá" (62:1761 / 62:2047) and 17c "Điểm
 * đang giữ để xét" (63:3676). Serves in-Rescom and Google Forms attempts.
 */
export default function CompletePage() {
  return (
    <Suspense>
      <CompleteScreen />
    </Suspense>
  );
}
