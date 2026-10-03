"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import type { ReactNode } from "react";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { VERSION_CHANGES_LOAD_FAILED, versionsLoadErrorMessage } from "@/lib/forms/results-messages";
import type { FormVersionSummary } from "@/lib/forms/results-service";
import {
  changeVerb,
  draftCaption,
  publishedCaption,
  type VersionChange,
} from "@/lib/forms/results-versions";
import { ResultsEmpty, ResultsError, ResultsLoading } from "../../responses/components/ResultsStatus";
import { useFormVersions } from "../hooks/use-form-versions";
import { VERSION_DETAIL_ENABLED, VERSION_DIFF_ENABLED } from "@/lib/forms/results-scope";

const ACTION = buttonClassName({ variant: "secondary", size: "md", radius: "field", className: "text-label" });
const PRIMARY_ACTION = buttonClassName({ variant: "primary", size: "md", radius: "field", className: "text-label" });

const VERB_CLASS: Record<VersionChange["kind"], string> = {
  ADDED: "text-tone-teal-fg",
  CHANGED: "text-tone-blue-fg",
  REMOVED: "text-danger",
};

function VersionHeader({
  version,
  status,
  caption,
  actions,
}: {
  version: FormVersionSummary;
  status: ReactNode;
  caption: string;
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-field bg-ink text-[16px] font-extrabold text-primary-foreground"
        >
          v{version.versionNumber}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[17px] font-extrabold text-ink">Phiên bản v{version.versionNumber}</h2>
            {status}
          </div>
          <p className="mt-0.5 text-caption text-ink-muted">{caption}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2.5">{actions}</div>
    </div>
  );
}

function Changes({
  base,
  changes,
  loading,
  failed,
  onRetry,
}: {
  base: FormVersionSummary;
  changes: VersionChange[] | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-control bg-surface-muted p-4">
      <h3 className="text-label font-bold text-ink">Thay đổi so với v{base.versionNumber}</h3>
      {failed ? (
        <p className="mt-2 text-body-sm text-danger">
          {VERSION_CHANGES_LOAD_FAILED}{" "}
          <button type="button" onClick={onRetry} className="font-bold underline">
            Thử lại
          </button>
        </p>
      ) : loading && !changes ? (
        <p className="mt-2 text-body-sm text-ink-muted">Đang so sánh…</p>
      ) : changes && changes.length ? (
        <ul className="mt-1.5 pl-4.5">
          {changes.map((change) => (
            <li key={`${change.kind}-${change.questionNumber}`} className="text-body-sm leading-[23.8px] text-ink-strong">
              <span className={`font-bold ${VERB_CLASS[change.kind]}`}>{changeVerb(change.kind)}</span> {change.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-body-sm text-ink-muted">Chưa có thay đổi nào.</p>
      )}
    </div>
  );
}

/** Figma 17a "Lịch sử phiên bản": draft on top (changes vs the published one), published versions locked. */
export function VersionsScreen() {
  const { id } = useParams<{ id: string }>();
  const { versions, error, reload, draft, base, changes, changesLoading, changesFailed, reloadChanges } =
    useFormVersions(id);
  // `POST /forms/:id/publish` accepts a DRAFT survey only (a withdrawn CLOSED one cannot be resubmitted).
  const { form } = useFormHeader();
  const draftSubmittable = form?.status === "DRAFT";

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12">
      {error && !versions ? (
        <ResultsError message={versionsLoadErrorMessage(error)} onRetry={reload} />
      ) : !versions ? (
        <ResultsLoading label="Đang tải lịch sử phiên bản…" />
      ) : versions.length === 0 ? (
        <ResultsEmpty title="Chưa có phiên bản nào" />
      ) : (
        <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-6">
          <ol className="flex flex-col gap-4">
            {versions.map((version) =>
              version.isPublished ? (
                <li key={version.id} className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface p-5 lg:p-6">
                  <VersionHeader
                    version={version}
                    status={
                      <Tag tone="teal" icon={<Icon name="lock" size={12} />}>
                        Đã xuất bản · khoá
                      </Tag>
                    }
                    caption={publishedCaption(version)}
                    actions={
                      <>
                        {VERSION_DETAIL_ENABLED ? (
                          <Link href={`/forms/${id}/versions/${version.versionNumber}`} className={ACTION}>
                            Xem (chỉ đọc)
                          </Link>
                        ) : null}
                        <Link href={`/forms/${id}/responses?v=${version.versionNumber}`} className={ACTION}>
                          Câu trả lời
                        </Link>
                      </>
                    }
                  />
                </li>
              ) : (
                <li
                  key={version.id}
                  className={`flex flex-col gap-3 rounded-[20px] bg-surface p-5 lg:p-5.5 ${
                    version.id === draft?.id ? "border-2 border-primary" : "border border-line"
                  }`}
                >
                  <VersionHeader
                    version={version}
                    status={<Tag tone="amber">Bản nháp</Tag>}
                    caption={draftCaption(version)}
                    actions={
                      <>
                        <Link href={`/forms/${id}/builder`} className={ACTION}>
                          Tiếp tục sửa
                        </Link>
                        {/* A new version goes live only through moderation: `POST /forms/:id/publish` from
                            the builder's publish step (reopen refuses it: FORM_NOT_REOPENABLE / VERSION_NOT_APPROVED). */}
                        {base && draftSubmittable && version.id === draft?.id ? (
                          <Link href={`/forms/${id}/builder/publish`} className={PRIMARY_ACTION}>
                            Gửi duyệt v{version.versionNumber}
                          </Link>
                        ) : null}
                      </>
                    }
                  />
                  {VERSION_DIFF_ENABLED && version.id === draft?.id && base ? (
                    <Changes
                      base={base}
                      changes={changes}
                      loading={changesLoading}
                      failed={changesFailed}
                      onRetry={reloadChanges}
                    />
                  ) : null}
                </li>
              ),
            )}
          </ol>
          <aside aria-labelledby="versions-help" className="rounded-[20px] border border-line bg-surface p-5.5">
            <h2 id="versions-help" className="text-[16px] leading-[24.8px] font-extrabold text-ink">
              Phiên bản hoạt động thế nào
            </h2>
            <div className="mt-2.5 flex flex-col gap-3.5 text-body-sm leading-[21.7px] text-ink-strong">
              <p>Phiên bản đã xuất bản không sửa được. Muốn thay đổi, bạn sửa trên một bản nháp mới.</p>
              <p>
                Mỗi câu trả lời luôn gắn với đúng phiên bản mà người trả lời đã làm, nên dữ liệu v1 không bị lẫn câu hỏi
                mới.
              </p>
              <p>Người đã làm v1 không làm lại được trên v2. Bản nháp mới chỉ chạy sau khi bạn gửi duyệt và Admin duyệt.</p>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
