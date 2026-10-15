import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { CodeIssuesScreen } from "./components/CodeIssuesScreen";

export const metadata: Metadata = { title: "Báo cáo mã lỗi | Rescom Admin" };
export default function CodeIssuesPage() {
  if (!REWARDS_ENABLED) notFound();
  return <CodeIssuesScreen />;
}
