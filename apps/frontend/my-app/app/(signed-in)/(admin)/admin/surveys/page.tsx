import type { Metadata } from "next";
import { SurveyModerationScreen } from "./components/SurveyModerationScreen";

export const metadata: Metadata = {
  title: "Duyệt khảo sát — Rescom Admin",
};

/** `/admin/surveys[?id=<formId>]` — Figma 11a "Duyệt khảo sát" (62:3406) + 11a' "Từ chối" (62:2868). */
export default function AdminSurveysPage() {
  return <SurveyModerationScreen />;
}
