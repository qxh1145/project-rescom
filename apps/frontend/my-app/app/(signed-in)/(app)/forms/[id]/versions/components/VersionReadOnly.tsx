"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import { useApiQuery } from "@/lib/api/use-api-query";
import { versionsLoadErrorMessage } from "@/lib/forms/results-messages";
import { getFormVersion, getFormVersions } from "@/lib/forms/results-service";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { ResultsEmpty, ResultsError, ResultsLoading } from "../../responses/components/ResultsStatus";

/** Read-only question list of one version ("Xem (chỉ đọc)", 17a). ASSUMED layout — not drawn in Figma. */
export function VersionReadOnly({ versionNumber }: { versionNumber: number }) {
  const { id } = useParams<{ id: string }>();
  const query = useApiQuery(`form-version-view:${id}:${versionNumber}`, async (signal) => {
    const versions = await getFormVersions(id, signal);
    const summary = versions.find((version) => version.versionNumber === versionNumber);
    return summary ? getFormVersion(id, summary.id, signal) : null;
  });
  const sessionLost = useSessionLossRedirect(query.error);
  const version = query.data;
  const blocks = version ? [...version.schemaJson.blocks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];

  return (
    <div className="mx-auto w-full max-w-[960px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12">
      <Link
        href={`/forms/${id}/versions`}
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-label font-bold text-primary hover:underline"
      >
        <Icon name="chevron-left" size={18} />
        Lịch sử phiên bản
      </Link>
      {query.error && version === undefined && !sessionLost ? (
        <ResultsError message={versionsLoadErrorMessage(query.error)} onRetry={query.reload} />
      ) : version === undefined ? (
        <ResultsLoading label="Đang tải phiên bản…" />
      ) : version === null ? (
        <ResultsEmpty title={`Không có phiên bản v${versionNumber}`} />
      ) : (
        <section className="rounded-[20px] border border-line bg-surface p-5 lg:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[18px] font-extrabold text-ink">Phiên bản v{version.versionNumber}</h2>
            {version.isPublished ? (
              <Tag tone="teal" icon={<Icon name="lock" size={12} />}>
                Chỉ đọc
              </Tag>
            ) : (
              <Tag tone="amber">Bản nháp</Tag>
            )}
          </div>
          {blocks.length ? (
            <ol className="mt-3">
              {blocks.map((block, index) => (
                <li key={block.id} className="flex flex-col gap-1.5 border-t border-line-subtle py-3">
                  <p className="text-body font-semibold text-ink">
                    Câu {index + 1} · {block.title}
                    {block.required ? <span className="text-danger"> *</span> : null}
                  </p>
                  {block.options?.length ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {block.options.map((option) => (
                        <li key={option.label} className="rounded-full bg-surface-subtle px-2.5 py-1 text-caption text-ink">
                          {option.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-body-sm text-ink-muted">
              Khảo sát Google Forms: câu hỏi nằm trong Google Forms, Rescom chỉ lưu đường dẫn và mã hoàn thành.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
