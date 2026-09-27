import type { Metadata } from "next";
import { ResponsesScreen } from "./components/ResponsesScreen";

export const metadata: Metadata = {
  title: "Câu trả lời — Rescom",
};

/**
 * `/forms/:id/responses` — Figma 10d "Câu trả lời" (63:3709 desktop, 63:4534
 * mobile). Rendered inside the survey header + tabs of `forms/[id]/layout.tsx`.
 */
export default function FormResponsesPage() {
  return <ResponsesScreen selectedId={null} />;
}
