import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { MyVouchersScreen } from "../components/MyVouchersScreen";

export const metadata: Metadata = {
  title: "Voucher của tôi | Rescom",
};

export default function MyVouchersPage() {
  if (!REWARDS_ENABLED) notFound();
  return <MyVouchersScreen />;
}
