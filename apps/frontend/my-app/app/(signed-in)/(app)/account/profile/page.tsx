import type { Metadata } from "next";
import { ProfileScreen } from "../components/ProfileScreen";

export const metadata: Metadata = {
  title: "Hồ sơ của bạn | Rescom",
};

/** Figma 15h "Hồ sơ (sửa từng mục)" (63:2469 mobile; desktop = 15g, ASSUMED (design)). */
export default function ProfilePage() {
  return <ProfileScreen />;
}
