import type { Metadata } from "next";
import { WalletScreen } from "./components/WalletScreen";

export const metadata: Metadata = {
  title: "Ví điểm | Rescom",
};

/** `/wallet` — Figma page 7 "Ví điểm" (62:225 desktop, 62:1052 mobile). */
export default function WalletPage() {
  return <WalletScreen />;
}
