import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { AiChatScreen } from "./components/AiChatScreen";

export const metadata: Metadata = {
  title: "Soạn bằng AI | Rescom",
};

/** Figma 13b / 13b' / 13g / 13h "Soạn bằng AI" for an existing draft (the screen reads the id from the URL). */
export default function FormBuilderAiPage() {
  if (PILOT_BUILD) notFound();
  return <AiChatScreen />;
}
