import type { Metadata } from "next";
import { SubmittedScreen } from "./components/SubmittedScreen";

export const metadata: Metadata = {
  title: "Đã gửi khảo sát — Rescom",
};

/**
 * `/forms/:id/submitted` — Figma 9d (62:2708 desktop, 62:3015 mobile). In
 * `(focus)`: the mobile frame has no bottom nav, and the survey-detail
 * layout of `(app)/forms/[id]` must not wrap this screen.
 */
export default function SurveySubmittedPage() {
  return <SubmittedScreen />;
}
