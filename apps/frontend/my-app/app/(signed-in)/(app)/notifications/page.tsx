import type { Metadata } from "next";
import { NotificationsScreen } from "./components/NotificationsScreen";

export const metadata: Metadata = {
  title: "Thông báo — Rescom",
};

/** Figma 14d "Trung tâm thông báo" (62:2117); the desktop header panel is 62:1837. */
export default function NotificationsPage() {
  return <NotificationsScreen />;
}
