import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketplaceScreen } from "./components/MarketplaceScreen";

export const metadata: Metadata = {
  title: "Khám phá khảo sát — Rescom",
};

/** `/marketplace` — filters live in the query string (`useSearchParams` needs the Suspense boundary). */
export default function MarketplacePage() {
  return (
    <Suspense>
      <MarketplaceScreen />
    </Suspense>
  );
}
