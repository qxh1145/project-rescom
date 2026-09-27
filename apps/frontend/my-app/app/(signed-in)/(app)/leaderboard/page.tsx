import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardScreen } from "./components/LeaderboardScreen";

export const metadata: Metadata = {
  title: "Bảng xếp hạng — Rescom",
};

/** `/leaderboard` — Figma 16b (63:3114 / 63:4078). `useSearchParams` needs the Suspense boundary. */
export default function LeaderboardPage() {
  return (
    <Suspense>
      <LeaderboardScreen />
    </Suspense>
  );
}
