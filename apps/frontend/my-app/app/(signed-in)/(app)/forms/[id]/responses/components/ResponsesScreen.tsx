"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { REVIEW_DISCLAIMER, responsesLoadErrorMessage } from "@/lib/forms/results-messages";
import type { FormResponse, FormResponses } from "@/lib/forms/results-service";
import {
  filterResponses,
  MOBILE_INITIAL_COUNT,
  paginate,
  parsePage,
  parseQualityFilter,
  qualityCounts,
  responseLabel,
  responsePosition,
  type QualityFilter,
  type ResponsePosition,
} from "@/lib/forms/results-view";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useResponses } from "../hooks/responses-context";
import { ResponseAnswers, ResponseMeta } from "./ResponseAnswers";
import { ResponseCards, ResponseDetailMobile } from "./ResponsesMobile";
import { ResponsesTable } from "./ResponsesTable";
import { ColumnPicker, QualityChips, QualitySegments, SearchBox } from "./ResponsesToolbar";
import { ResultsEmpty, ResultsError, ResultsLoading } from "./ResultsStatus";

const MOBILE_STEP = 20;

function AsideNav({ position, hrefFor }: { position: ResponsePosition; hrefFor: (response: FormResponse) => string }) {
  const item = (response: FormResponse | null, label: string, icon: "chevron-left" | "chevron-right") =>
    response ? (
      <Link
        href={hrefFor(response)}
        scroll={false}
        aria-label={`${label} ${responseLabel(response)}`}
        className="inline-flex size-10 items-center justify-center rounded-[10px] border border-line-strong bg-surface text-ink hover:bg-surface-subtle"
      >
        <Icon name={icon} size={18} />
      </Link>
    ) : (
      <span
        aria-disabled="true"
        aria-label={label}
        className="inline-flex size-10 items-center justify-center rounded-[10px] border border-line bg-disabled text-ink-muted"
      >
        <Icon name={icon} size={18} />
      </span>
    );
  return (
    <div className="flex gap-2">
      {item(position.previous, "Câu trả lời trước", "chevron-left")}
      {item(position.next, "Câu trả lời sau", "chevron-right")}
    </div>
  );
}

/** Desktop side panel (63:3944): the open response. */
function ResponseAside({
  data,
  response,
  position,
  hrefFor,
}: {
  data: FormResponses;
  response: FormResponse;
  position: ResponsePosition;
  hrefFor: (response: FormResponse) => string;
}) {
  return (
    <aside
      aria-label={`Câu trả lời ${responseLabel(response)}`}
      className="flex flex-col gap-3 rounded-[22px] border border-line bg-surface p-5.5 lg:sticky lg:top-6"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-extrabold text-ink">Câu trả lời {responseLabel(response)}</h2>
          <p className="text-caption text-ink-muted">
            {position.index} / {position.total}
          </p>
        </div>
        <AsideNav position={position} hrefFor={hrefFor} />
      </div>
      <ResponseMeta response={response} variant="panel" />
      <ResponseAnswers data={data} response={response} variant="panel" />
    </aside>
  );
}

/**
 * Figma 10d "Câu trả lời" + 10d' "Chi tiết một câu trả lời". Filters live in
 * the URL (`?quality=passed|review&q=…&page=2&v=1`) so a row link and the
 * back link keep them. Desktop: table + side panel (the first row of the page
 * when none is open — ASSUMED). Mobile: cards, or the detail page.
 */
export function ResponsesScreen({ selectedId }: { selectedId: string | null }) {
  const { formId, data, error, loading, reload, columnIds, setColumnIds, mobileVisible, setMobileVisible } =
    useResponses();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const quality = parseQualityFilter(search.get("quality"));
  const requestedPage = parsePage(search.get("page"));
  const urlQuery = search.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const debouncedQuery = useDebouncedValue(query, 250);

  const queryString = search.toString() ? `?${search.toString()}` : "";
  const base = `/forms/${formId}/responses`;
  // The list lives under "Từng câu trả lời"; a row keeps its `/responses/:responseId` URL.
  const listHref = `${base}/individual${queryString}`;
  const hrefFor = useCallback((response: FormResponse) => `${base}/${response.id}${queryString}`, [base, queryString]);

  const updateUrl = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(search.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [pathname, router, search],
  );

  useEffect(() => {
    if (debouncedQuery.trim() !== urlQuery.trim()) updateUrl({ q: debouncedQuery.trim() || null, page: null });
  }, [debouncedQuery, urlQuery, updateUrl]);

  const setQuality = (value: QualityFilter) => {
    setMobileVisible(MOBILE_INITIAL_COUNT);
    updateUrl({ quality: value === "all" ? null : value, page: null });
  };

  const questions = useMemo(() => data?.questions ?? [], [data]);
  const columns = useMemo(() => questions.filter((question) => columnIds.includes(question.id)), [questions, columnIds]);
  const filtered = useMemo(
    () => (data ? filterResponses(data.responses, questions, { quality, query: urlQuery }) : []),
    [data, questions, quality, urlQuery],
  );
  const page = useMemo(() => paginate(filtered, requestedPage), [filtered, requestedPage]);
  const counts = useMemo(() => qualityCounts(data?.responses ?? []), [data]);

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-5 pb-8 lg:px-12">
        <ResultsError message={responsesLoadErrorMessage(error)} onRetry={reload} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-5 lg:px-12" aria-busy={loading}>
        <ResultsLoading label="Đang tải câu trả lời…" />
      </div>
    );
  }

  const selected = selectedId ? (data.responses.find((response) => response.id === selectedId) ?? null) : null;
  const shownInAside = selectedId ? selected : (page.items[0] ?? null);
  const position = shownInAside ? responsePosition(data.responses, shownInAside.id) : null;
  const questionCount = questions.length;

  if (data.responses.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12">
        <ResultsEmpty title="Chưa có câu trả lời nào">
          Khi có người hoàn thành khảo sát (phiên bản v{data.form.versionNumber}), câu trả lời sẽ hiện ở đây kèm đánh giá
          chất lượng.
        </ResultsEmpty>
      </div>
    );
  }

  return (
    <>
      {/* Mobile detail page (10d'). */}
      {selectedId ? (
        selected && position ? (
          <ResponseDetailMobile
            data={data}
            response={selected}
            position={position}
            listHref={listHref}
            hrefFor={hrefFor}
          />
        ) : (
          <div className="px-5 pt-4 lg:hidden">
            <ResultsEmpty
              title="Không tìm thấy câu trả lời này"
              action={
                <Link href={listHref} className="font-bold text-primary hover:underline">
                  Về danh sách câu trả lời
                </Link>
              }
            >
              Câu trả lời có thể thuộc phiên bản khác của khảo sát.
            </ResultsEmpty>
          </div>
        )
      ) : null}

      <div
        className={`mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12 ${selectedId ? "max-lg:hidden" : ""}`}
      >
        {/* Mobile list (10d mobile). */}
        <div className="flex flex-col gap-3 lg:hidden">
          <SearchBox size="mobile" value={query} onChange={setQuery} />
          <QualityChips value={quality} counts={counts} onChange={setQuality} />
          <p className="text-caption text-ink-muted">
            Mới nhất trước{questionCount ? ` · chạm để xem đủ ${questionCount} câu` : ""}
          </p>
          {filtered.length ? (
            <ResponseCards
              data={data}
              responses={filtered}
              columns={columns}
              hrefFor={hrefFor}
              visible={mobileVisible}
              onShowMore={() => setMobileVisible(mobileVisible + MOBILE_STEP)}
            />
          ) : (
            <p className="py-8 text-center text-body-sm text-ink-muted">Không có câu trả lời phù hợp.</p>
          )}
        </div>

        {/* Desktop table + side panel (10d desktop). */}
        <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-5">
          <section
            aria-label="Danh sách câu trả lời"
            className="flex min-w-0 flex-col gap-4 rounded-[22px] border border-line bg-surface p-5"
          >
            <div className="flex flex-wrap items-center gap-3">
              <SearchBox size="desktop" value={query} onChange={setQuery} />
              <QualitySegments value={quality} counts={counts} onChange={setQuality} />
              {questionCount ? (
                <div className="ml-auto">
                  <ColumnPicker questions={questions} columnIds={columnIds} onChange={setColumnIds} />
                </div>
              ) : null}
            </div>
            {page.total ? (
              <ResponsesTable
                data={data}
                page={page}
                columns={columns}
                selectedId={shownInAside?.id ?? null}
                hrefFor={hrefFor}
                onPage={(next) => updateUrl({ page: next > 1 ? String(next) : null })}
              />
            ) : (
              <p className="py-10 text-center text-body-sm text-ink-muted">Không có câu trả lời phù hợp.</p>
            )}
            <p className="text-[12px] leading-[18px] text-ink-muted">
              {questionCount
                ? `Bảng đang hiện ${columns.length} trong ${questionCount} câu hỏi. Chọn một dòng để xem đủ, hoặc xuất file để có tất cả câu hỏi. `
                : "Câu trả lời Google Forms nằm trong Google Forms của bạn; Rescom lưu mã hoàn thành đã xác minh. "}
              {REVIEW_DISCLAIMER}
            </p>
          </section>
          {shownInAside && position ? (
            <ResponseAside data={data} response={shownInAside} position={position} hrefFor={hrefFor} />
          ) : (
            <aside className="rounded-[22px] border border-line bg-surface p-5.5 text-body-sm text-ink-muted">
              {selectedId ? "Không tìm thấy câu trả lời này trong phiên bản đang xem." : "Chọn một dòng để xem đủ câu trả lời."}
            </aside>
          )}
        </div>
      </div>
    </>
  );
}
