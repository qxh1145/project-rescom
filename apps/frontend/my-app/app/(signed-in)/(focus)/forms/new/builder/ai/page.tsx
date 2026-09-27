import type { Metadata } from "next";
import { AiChatScreen } from "../../../[id]/builder/ai/components/AiChatScreen";

export const metadata: Metadata = {
  title: "Soạn bằng AI — Rescom",
};

/** Figma 13b / 13g entry before a draft exists: the first prompt creates it. */
export default function NewFormAiPage() {
  return <AiChatScreen formId={null} />;
}
