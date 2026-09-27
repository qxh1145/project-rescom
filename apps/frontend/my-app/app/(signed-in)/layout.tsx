import type { ReactNode } from "react";
import { ProductTourProvider } from "@/components/product-tour/TourProvider";
import { SessionProvider } from "@/lib/session/SessionProvider";

/**
 * Parent of the signed-in route groups `(app)` and `(focus)`: one
 * `SessionProvider` for both, so moving between them (Khám phá → làm khảo
 * sát) keeps the session, points and badge instead of re-fetching them.
 * Each group keeps its own `SessionGate` inside its shell. URLs are unchanged.
 * `ProductTourProvider` lives here too, so a product tour keeps going across
 * both groups (Khám phá → Google Forms attempt → Ví điểm).
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ProductTourProvider>{children}</ProductTourProvider>
    </SessionProvider>
  );
}
