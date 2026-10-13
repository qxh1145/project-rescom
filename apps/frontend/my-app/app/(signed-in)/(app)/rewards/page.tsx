import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { RewardsScreen } from "./components/RewardsScreen";

export const metadata: Metadata = {
  title: "Đổi quà | Rescom",
};

export default function RewardsPage() {
  if (PILOT_BUILD) notFound();
  return <RewardsScreen />;
}
