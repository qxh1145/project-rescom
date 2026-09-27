import { Suspense, type ReactNode } from "react";
import { ResponsesProvider } from "./hooks/responses-context";

/** Keeps the loaded responses while moving between `/responses` and `/responses/:responseId`. */
export default function ResponsesLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <ResponsesProvider>{children}</ResponsesProvider>
    </Suspense>
  );
}
