import type { Metadata } from "next";
import { TopUpRouter } from "../components/TopUpRouter";

export const metadata: Metadata = {
  title: "Nạp điểm | Rescom",
};

/** `/wallet/top-up/:id` — resolves PayOS or legacy MANUAL top-up */
export default function TopUpTransferPage() {
  return <TopUpRouter />;
}
