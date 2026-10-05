import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { Suspense } from "react";
import { LeaderboardScreen } from "./components/LeaderboardScreen";

export const metadata: Metadata = {
  title: "Bảng xếp hạng — Rescom",
};

/** `/leaderboard` — Figma 16b (63:3114 / 63:4078). `useSearchParams` needs the Suspense boundary. */
export default function LeaderboardPage() {
  if (PILOT_BUILD) notFound();
  return (
    <Suspense>
      <LeaderboardScreen />
    </Suspense>
  );
}
