import type { Metadata } from "next";
import { ResubmitScreen } from "./components/ResubmitScreen";

export const metadata: Metadata = {
  title: "Sửa & gửi lại khảo sát | Rescom",
};

/**
 * `/forms/:id/resubmit` — "Sửa & gửi lại" of a rejected in-Rescom survey over
 * the Tiến độ tab. ASSUMED UI (not drawn): the backend never edits a rejected
 * (CLOSED) survey, so the dialog copies it into a new Form Builder draft.
 */
export default function ResubmitPage() {
  return <ResubmitScreen />;
}
