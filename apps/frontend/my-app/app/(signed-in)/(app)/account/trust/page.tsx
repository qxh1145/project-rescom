import type { Metadata } from "next";
import { TrustScreen } from "./components/TrustScreen";

export const metadata: Metadata = {
  title: "Độ tin cậy câu trả lời — Rescom",
};

/** Figma 17d "Độ tin cậy câu trả lời" (63:5117) — read-only, inside the app shell. */
export default function TrustPage() {
  return <TrustScreen />;
}
