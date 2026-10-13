import type { Metadata } from "next";
import { ChoosePackageScreen } from "./components/ChoosePackageScreen";

export const metadata: Metadata = {
  title: "Nạp điểm | Rescom",
};

/** `/wallet/top-up` — Figma 14a "chọn gói" (62:2806; desktop derived, ASSUMED (design)). */
export default function TopUpPage() {
  return <ChoosePackageScreen />;
}
