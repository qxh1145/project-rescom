import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { CodeIssuesScreen } from "./components/CodeIssuesScreen";

export const metadata: Metadata = { title: "Báo cáo mã lỗi | Rescom Admin" };
export default function CodeIssuesPage() {
  if (PILOT_BUILD) notFound();
  return <CodeIssuesScreen />;
}
