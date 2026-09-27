import type { Metadata } from "next";
import { ResponsesScreen } from "../components/ResponsesScreen";

export const metadata: Metadata = {
  title: "Chi tiết câu trả lời — Rescom",
};

/**
 * `/forms/:id/responses/:responseId` — Figma 10d' "Chi tiết một câu trả lời"
 * (63:2033 mobile). Desktop (ASSUMED, derived from 10d): the list with this
 * row open in the side panel.
 */
export default async function FormResponseDetailPage({ params }: { params: Promise<{ responseId: string }> }) {
  const { responseId } = await params;
  return <ResponsesScreen selectedId={responseId} />;
}
