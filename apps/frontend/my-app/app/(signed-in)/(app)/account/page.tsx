import type { Metadata } from "next";
import { AccountScreen } from "./components/AccountScreen";

export const metadata: Metadata = {
  title: "Tài khoản | Rescom",
};

/** Figma 15g "Tài khoản" (63:483 desktop, 63:1426 mobile). */
export default function AccountPage() {
  return <AccountScreen />;
}
