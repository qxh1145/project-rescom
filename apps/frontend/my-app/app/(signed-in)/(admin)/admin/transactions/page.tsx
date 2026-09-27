import type { Metadata } from "next";
import { TransactionsScreen } from "./components/TransactionsScreen";

export const metadata: Metadata = {
  title: "Giao dịch điểm — Rescom Admin",
};

/** `/admin/transactions` — Figma 11f "Giao dịch điểm" (63:1629, desktop only). */
export default function AdminTransactionsPage() {
  return <TransactionsScreen />;
}
