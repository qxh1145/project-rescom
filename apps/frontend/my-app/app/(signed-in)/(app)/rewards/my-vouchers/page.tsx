import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { MyVouchersScreen } from "../components/MyVouchersScreen";

export const metadata: Metadata = {
  title: "Voucher của tôi | Rescom",
};

export default function MyVouchersPage() {
  if (PILOT_BUILD) notFound();
  return <MyVouchersScreen />;
}
