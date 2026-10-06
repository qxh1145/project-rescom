import type { Metadata } from "next";
import { VersionReadOnly } from "../components/VersionReadOnly";

export const metadata: Metadata = {
  title: "Xem phiên bản | Rescom",
};

/** `/forms/:id/versions/:versionNumber` — "Xem (chỉ đọc)" of 17a (not drawn; ASSUMED (design) simple question list). */
export default async function FormVersionPage({ params }: { params: Promise<{ versionNumber: string }> }) {
  const { versionNumber } = await params;
  return <VersionReadOnly versionNumber={Number(versionNumber)} />;
}
