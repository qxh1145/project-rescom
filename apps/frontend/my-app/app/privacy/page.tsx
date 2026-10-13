import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/legal/LegalPlaceholder";

export const metadata: Metadata = {
  title: "Chính sách quyền riêng tư | Rescom",
};

export default function PrivacyPage() {
  return <LegalPlaceholder title="Chính sách quyền riêng tư" />;
}
