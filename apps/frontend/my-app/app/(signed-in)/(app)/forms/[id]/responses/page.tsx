import type { Metadata } from "next";
import { SummaryScreen } from "./components/SummaryScreen";

export const metadata: Metadata = {
  title: "Tóm tắt câu trả lời — Rescom",
};

/**
 * `/forms/:id/responses` — Tóm tắt: header metrics + one chart card per
 * question (ASSUMED, no Figma frame). The table moved to `/responses/individual`.
 */
export default function FormResponsesPage() {
  return <SummaryScreen />;
}
