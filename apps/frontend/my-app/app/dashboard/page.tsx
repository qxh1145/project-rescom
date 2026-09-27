import { redirect } from "next/navigation";

/** Legacy dashboard: Khám phá is the signed-in home now (Figma 3). */
export default function DashboardPage() {
  redirect("/marketplace");
}
