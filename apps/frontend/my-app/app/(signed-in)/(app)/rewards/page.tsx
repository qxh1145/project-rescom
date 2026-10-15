import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { RewardsScreen } from "./components/RewardsScreen";

export const metadata: Metadata = {
  title: "Đổi quà | Rescom",
};

export default function RewardsPage() {
  if (!REWARDS_ENABLED) notFound();
  return <RewardsScreen />;
}
