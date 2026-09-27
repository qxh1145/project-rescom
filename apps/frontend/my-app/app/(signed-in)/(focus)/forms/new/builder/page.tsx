import type { Metadata } from "next";
import { NewBuilderScreen } from "./components/NewBuilderScreen";

export const metadata: Metadata = {
  title: "Soạn form — Rescom",
};

/**
 * "Tạo khảo sát → Soạn trong Rescom": creates an In-Rescom draft
 * (`POST /forms`, VERIFIED) and opens the Form Builder (Figma 13 · 63:4221).
 */
export default function NewFormBuilderPage() {
  return <NewBuilderScreen />;
}
