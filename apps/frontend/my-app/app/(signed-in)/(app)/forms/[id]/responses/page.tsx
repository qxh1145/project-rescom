import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SummaryScreen } from "./components/SummaryScreen";

export const metadata: Metadata = {
  title: "Tóm tắt câu trả lời — Rescom",
};

/** Query keys of the response table (before it moved to `/individual`). */
const TABLE_PARAMS = ["quality", "q", "page"];

/**
 * `/forms/:id/responses` — Tóm tắt: header metrics + one chart card per
 * question (ASSUMED, no Figma frame). The table moved to `/responses/individual`;
 * a legacy bookmark carrying its filters (`?quality=review&page=2&q=…`) lands
 * there with the same query string.
 */
export default async function FormResponsesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  if (TABLE_PARAMS.some((key) => query[key] !== undefined)) {
    const { id } = await params;
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) search.append(key, item);
    }
    redirect(`/forms/${encodeURIComponent(id)}/responses/individual?${search.toString()}`);
  }
  return <SummaryScreen />;
}
