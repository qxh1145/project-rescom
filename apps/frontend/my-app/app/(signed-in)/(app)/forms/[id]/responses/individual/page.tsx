import type { Metadata } from "next";
import { ResponsesScreen } from "../components/ResponsesScreen";

export const metadata: Metadata = {
  title: "Từng câu trả lời | Rescom",
};

/**
 * `/forms/:id/responses/individual` — Figma 10d "Câu trả lời" (63:3709
 * desktop, 63:4534 mobile): the table + side panel, under the "Từng câu trả
 * lời" sub-nav tab.
 */
export default function FormResponsesIndividualPage() {
  return <ResponsesScreen selectedId={null} />;
}
