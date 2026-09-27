import type { Metadata } from "next";
import { StreakScreen } from "./components/StreakScreen";

export const metadata: Metadata = {
  title: "Chuỗi ngày — Rescom",
};

/** Figma 16a "Chuỗi ngày" (63:4629) — read-only, inside the app shell. */
export default function StreakPage() {
  return <StreakScreen />;
}
