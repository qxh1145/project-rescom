import { Suspense } from "react";
import type { Metadata } from "next";
import { PublishScreen } from "./components/PublishScreen";

export const metadata: Metadata = {
  title: "Đối tượng, số mẫu & điểm — Rescom",
};

/** Builder steps 2–3 and "Gửi duyệt" (pricing quote → publish → MODERATION_QUEUE). */
export default function FormBuilderPublishPage() {
  return (
    <Suspense>
      <PublishScreen />
    </Suspense>
  );
}
