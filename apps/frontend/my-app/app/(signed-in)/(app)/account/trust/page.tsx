import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { TrustScreen } from "./components/TrustScreen";

export const metadata: Metadata = {
  title: "Độ tin cậy câu trả lời — Rescom",
};

/** Figma 17d "Độ tin cậy câu trả lời" (63:5117) — read-only, inside the app shell. */
export default function TrustPage() {
  if (PILOT_BUILD) notFound();
  return <TrustScreen />;
}
