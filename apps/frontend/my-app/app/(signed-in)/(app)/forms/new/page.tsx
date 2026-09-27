import type { Metadata } from "next";
import { ChooseMethodScreen } from "./components/ChooseMethodScreen";

export const metadata: Metadata = {
  title: "Tạo khảo sát — Rescom",
};

/**
 * `/forms/new` — choose how to create a survey (Figma 63:2400): Google Forms
 * → `/forms/new/google-form` (wizard), Form Builder → `/forms/new/builder`.
 */
export default function NewSurveyPage() {
  return <ChooseMethodScreen />;
}
