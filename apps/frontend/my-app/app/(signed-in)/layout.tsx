import type { ReactNode } from "react";
import { SessionProvider } from "@/lib/session/SessionProvider";

/**
 * Parent of the signed-in route groups `(app)` and `(focus)`: one
 * `SessionProvider` for both, so moving between them (Khám phá → làm khảo
 * sát) keeps the session, points and badge instead of re-fetching them.
 * Each group keeps its own `SessionGate` inside its shell. URLs are unchanged.
 */
export default function SignedInLayout({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
