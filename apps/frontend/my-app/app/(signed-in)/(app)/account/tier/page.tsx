import type { Metadata } from "next";
import { TierScreen } from "./components/TierScreen";

export const metadata: Metadata = {
  title: "Hạng thành viên — Rescom",
};

/** Figma 16 "Hạng thành viên" (63:4981) — read-only, inside the app shell. */
export default function TierPage() {
  return <TierScreen />;
}
