import { Suspense, type ReactNode } from "react";
import { ResponsesSubnav } from "./components/ResponsesSubnav";
import { AnalyticsProvider } from "./hooks/analytics-context";
import { ResponsesProvider } from "./hooks/responses-context";

/**
 * `/forms/:id/responses/*`: the Tóm tắt · Theo câu hỏi · Từng câu trả lời
 * sub-nav, plus the loaded analytics (Tóm tắt ↔ Theo câu hỏi) and responses
 * (`/individual` ↔ `/:responseId`) kept while moving between the views.
 */
export default function ResponsesLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <AnalyticsProvider>
        <ResponsesProvider>
          <ResponsesSubnav />
          {children}
        </ResponsesProvider>
      </AnalyticsProvider>
    </Suspense>
  );
}
