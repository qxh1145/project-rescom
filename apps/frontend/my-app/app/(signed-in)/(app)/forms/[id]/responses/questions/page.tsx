import type { Metadata } from "next";
import { QuestionScreen } from "../components/QuestionScreen";

export const metadata: Metadata = {
  title: "Câu trả lời theo câu hỏi | Rescom",
};

/** `/forms/:id/responses/questions?question=<id>` — one question at a time with its full table (ASSUMED, no Figma frame). */
export default function FormResponsesQuestionsPage() {
  return <QuestionScreen />;
}
