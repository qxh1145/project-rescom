import type { Metadata } from "next";
import { FraudLogScreen } from "./components/FraudLogScreen";

export const metadata: Metadata = {
  title: "FraudLog | Rescom Admin",
};

/**
 * `/admin/fraud-log[?userId=<uuid | #code>]` — Figma 11e "FraudLog (chỉ đọc)"
 * (62:2195, desktop only). The overview's flagged accounts link here with `userId`.
 */
export default async function AdminFraudLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await searchParams;
  const value = typeof userId === "string" ? userId : null;
  // Keyed so opening another user's link resets the filters.
  return <FraudLogScreen key={value ?? ""} urlUserId={value} />;
}
