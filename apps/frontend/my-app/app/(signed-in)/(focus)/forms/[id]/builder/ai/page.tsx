import type { Metadata } from "next";
import { AiChatScreen } from "./components/AiChatScreen";

export const metadata: Metadata = {
  title: "Soạn bằng AI — Rescom",
};

/** Figma 13b / 13b' / 13g / 13h "Soạn bằng AI" for an existing draft. */
export default async function FormBuilderAiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AiChatScreen formId={id} />;
}
