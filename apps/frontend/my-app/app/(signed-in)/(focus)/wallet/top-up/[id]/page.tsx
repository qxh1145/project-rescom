import type { Metadata } from "next";
import { TransferScreen } from "../components/TransferScreen";

export const metadata: Metadata = {
  title: "Chuyển khoản nạp điểm | Rescom",
};

/** `/wallet/top-up/:id` — Figma 14b "chuyển khoản" (62:3623 desktop, 62:3873 mobile). */
export default function TopUpTransferPage() {
  return <TransferScreen />;
}
