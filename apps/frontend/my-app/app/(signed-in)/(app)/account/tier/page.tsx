import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { TierScreen } from "./components/TierScreen";

export const metadata: Metadata = {
  title: "Hạng thành viên | Rescom",
};

/** Figma 16 "Hạng thành viên" (63:4981) — read-only, inside the app shell. */
export default function TierPage() {
  if (PILOT_BUILD) notFound();
  return <TierScreen />;
}
