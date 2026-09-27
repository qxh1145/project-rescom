"use client";

import Link from "next/link";
import { useParams, useSearchParams, useSelectedLayoutSegment } from "next/navigation";

type View = "summary" | "questions" | "individual";

const VIEWS: readonly { view: View; path: string; label: string }[] = [
  { view: "summary", path: "", label: "Tóm tắt" },
  { view: "questions", path: "/questions", label: "Theo câu hỏi" },
  { view: "individual", path: "/individual", label: "Từng câu trả lời" },
];

/** `responses/` child segment → view: none = Tóm tắt, a response id = Từng câu trả lời. */
function viewOf(segment: string | null): View {
  if (segment === null) return "summary";
  return segment === "questions" ? "questions" : "individual";
}

/**
 * Tóm tắt · Theo câu hỏi · Từng câu trả lời under the survey tabs. Links in
 * the SegmentedControl look; `?v=` (version) is carried across. Hidden on
 * mobile while one response is open (10d' has its own back bar).
 */
export function ResponsesSubnav() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const segment = useSelectedLayoutSegment();
  const active = viewOf(segment);
  const detail = segment !== null && segment !== "questions" && segment !== "individual";
  const version = search.get("v");
  const query = version ? `?v=${encodeURIComponent(version)}` : "";
  const base = `/forms/${encodeURIComponent(id)}/responses`;

  return (
    <div className={`mx-auto w-full max-w-[1440px] px-5 pt-4 lg:px-12 lg:pt-5 ${detail ? "max-lg:hidden" : ""}`}>
      <nav
        aria-label="Cách xem câu trả lời"
        className="flex w-full overflow-x-auto rounded-[14px] bg-surface-subtle p-1.25 sm:inline-flex sm:w-auto"
      >
        {VIEWS.map((item) => {
          const current = item.view === active;
          return (
            <Link
              key={item.view}
              href={`${base}${item.path}${query}`}
              scroll={false}
              aria-current={current ? "page" : undefined}
              className={[
                "inline-flex h-9 flex-1 items-center justify-center rounded-[10px] px-2.5 text-caption whitespace-nowrap transition-colors sm:flex-none sm:px-4 sm:text-label",
                current
                  ? "bg-surface font-bold text-ink shadow-[0_1px_2px_rgba(30,36,70,0.12)]"
                  : "font-semibold text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
