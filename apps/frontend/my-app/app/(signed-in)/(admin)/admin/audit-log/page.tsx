import type { Metadata } from "next";
import { AuditLogScreen } from "./components/AuditLogScreen";

export const metadata: Metadata = {
  title: "Nhật ký thao tác | Rescom Admin",
};

export default function AdminAuditLogPage() {
  return <AuditLogScreen />;
}
