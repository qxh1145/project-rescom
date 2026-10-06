import type { Metadata } from "next";
import { MyFormsScreen } from "./components/MyFormsScreen";

export const metadata: Metadata = {
  title: "Khảo sát của tôi | Rescom",
};

/** `/forms` — Figma page 10 "Khảo sát của tôi" (63:127 desktop, 63:1300 mobile). */
export default function MyFormsPage() {
  return <MyFormsScreen />;
}
