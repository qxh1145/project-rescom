import type { Metadata } from "next";
import { Suspense } from "react";
import { TopUpConsoleScreen } from "./components/TopUpConsoleScreen";

export const metadata: Metadata = {
  title: "Nạp điểm | Rescom Admin",
};

/** `/admin/top-ups?tab=payos|manual` admin top-up console. */
export default function AdminTopUpsPage() {
  return (
    <Suspense>
      <TopUpConsoleScreen />
    </Suspense>
  );
}
