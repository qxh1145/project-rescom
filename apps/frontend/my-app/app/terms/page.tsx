import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal/LegalPlaceholder";

export const metadata: Metadata = {
  title: "Điều khoản sử dụng — Rescom",
};

export default function TermsPage() {
  return <LegalPlaceholder title="Điều khoản sử dụng" />;
}
