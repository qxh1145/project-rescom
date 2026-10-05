"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Radio } from "@/components/ui/Radio";
import { Select } from "@/components/ui/Select";
import { Spinner } from "@/components/ui/Spinner";
import { useApiQuery } from "@/lib/api/use-api-query";
import {
  buildExportTable,
  DEFAULT_EXPORT_OPTIONS,
  exportFileName,
  exportShape,
  toCsv,
  type ExportOptions,
} from "@/lib/forms/results-export";
import {
  EXPORT_FAILED,
  GOOGLE_FORMS_ANSWERS_NOTE,
  RESPONSES_TRUNCATED_NOTE,
  responsesLoadErrorMessage,
} from "@/lib/forms/results-messages";
import { collectFormResponses } from "@/lib/forms/results-service";
import { buildXlsx, XLSX_MIME } from "@/lib/forms/results-xlsx";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Group({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <legend className="mb-3 text-label font-bold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Figma 10e: desktop modal (620px) / mobile bottom sheet, built from the real
 * responses (`RESPONSE_EXPORT_ENABLED`, open for internal testing). Only the
 * anonymous response code identifies a row (privacy note in the dialog).
 */
export function ExportDialog() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const version = Number(search.get("v")) || null;
  const titleId = useId();
  const query = useApiQuery(`form-export:${id}:${version ?? ""}`, (signal) => collectFormResponses(id, version, signal));
  const sessionLost = useSessionLossRedirect(query.error);
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [status, setStatus] = useState<{ tone: "info" | "danger"; text: string } | null>(null);

  const loaded = query.data ?? null;
  const data = loaded?.availability === "AVAILABLE" ? loaded : null;
  const table = useMemo(() => (data ? buildExportTable(data, options) : null), [data, options]);
  const hasMultipleChoice = Boolean(data?.questions.some((question) => question.type === "multiple_choice"));
  const backHref = `/forms/${id}/responses${version ? `?v=${version}` : ""}`;
  const close = () => router.push(backHref);
  const set = (patch: Partial<ExportOptions>) => {
    setStatus(null);
    setOptions((current) => ({ ...current, ...patch }));
  };

  const onDownload = () => {
    if (!data || !table) return;
    try {
      const fileName = exportFileName(data.form.title, data.form.versionNumber, options.format, new Date());
      const blob =
        options.format === "csv"
          ? new Blob([toCsv(table)], { type: "text/csv;charset=utf-8" })
          : new Blob([buildXlsx(table)], { type: XLSX_MIME });
      download(blob, fileName);
      setStatus({ tone: "info", text: `Đã tạo file ${fileName}.` });
    } catch {
      setStatus({ tone: "danger", text: EXPORT_FAILED });
    }
  };

  const questionCount = data?.questions.length ?? 0;
  const formatLabel = options.format === "xlsx" ? ".xlsx" : ".csv";
  const empty = Boolean(table && table.rows.length === 0);

  return (
    <Dialog
      open
      onClose={close}
      labelledBy={titleId}
      width={620}
      className="max-lg:mb-0 max-lg:w-full max-lg:max-w-none! max-lg:rounded-b-none"
    >
      <div className="flex flex-col gap-5 px-5 pt-3 pb-6 lg:px-8 lg:pt-7 lg:pb-7">
        <span aria-hidden="true" className="mx-auto h-1.25 w-10 rounded-full bg-line lg:hidden" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[20px] font-extrabold text-ink lg:text-[22px]">
              Xuất câu trả lời
            </h2>
            {data ? (
              <p className="mt-1 text-caption text-ink-muted lg:text-body-sm">
                <span className="max-lg:hidden">{data.form.title} · </span>
                <span className="lg:hidden">{data.responses.length} câu trả lời · </span>
                <span className="max-lg:hidden">phiên bản </span>form v{data.form.versionNumber}
                {questionCount ? ` · ${questionCount} câu hỏi` : " · Google Forms"}
              </p>
            ) : null}
          </div>
          <IconButton icon="x" label="Đóng" onClick={close} />
        </div>

        {loaded?.availability === "NOT_APPLICABLE" ? (
          <Alert tone="info">{GOOGLE_FORMS_ANSWERS_NOTE}</Alert>
        ) : query.error && !data && !sessionLost ? (
          <div className="flex flex-col gap-3">
            <Alert tone="danger">{responsesLoadErrorMessage(query.error)}</Alert>
            <Button variant="secondary" size="base" radius="field" onClick={query.reload}>
              Thử lại
            </Button>
          </div>
        ) : !data || !table ? (
          <p className="flex items-center gap-3 py-10 text-body text-ink-muted" role="status" aria-busy="true">
            <Spinner className="size-5 text-primary" />
            Đang chuẩn bị dữ liệu…
          </p>
        ) : (
          <>
            <Group title="Định dạng file">
              <div className="grid gap-2 lg:grid-cols-2 lg:gap-3">
                <Radio
                  variant="card"
                  size={20}
                  name="export-format"
                  id="export-xlsx"
                  checked={options.format === "xlsx"}
                  onChange={() => set({ format: "xlsx" })}
                  label={<span className="font-bold">Excel (.xlsx)</span>}
                  description={
                    <>
                      <span className="max-lg:hidden">
                        Mở bằng Excel hoặc Google Sheets. Mỗi câu hỏi một cột, có sẵn tiêu đề.
                      </span>
                      <span className="lg:hidden">Mở bằng Excel hoặc Google Sheets</span>
                    </>
                  }
                />
                <Radio
                  variant="card"
                  size={20}
                  name="export-format"
                  id="export-csv"
                  checked={options.format === "csv"}
                  onChange={() => set({ format: "csv" })}
                  label={<span className="font-bold">CSV (.csv)</span>}
                  description={
                    <>
                      <span className="max-lg:hidden">UTF-8, giữ đúng tiếng Việt. Dùng cho SPSS, R hoặc Python.</span>
                      <span className="lg:hidden">UTF-8, dùng cho SPSS, R, Python</span>
                    </>
                  }
                />
              </div>
            </Group>

            <div className="grid gap-5 lg:grid-cols-2 lg:gap-4">
              <Group title="Câu trả lời">
                <p className="text-body-sm text-ink">Tất cả · {data.responses.length}</p>
                {data.truncated ? <p className="text-caption text-tone-amber-fg">{RESPONSES_TRUNCATED_NOTE}</p> : null}
              </Group>
              {hasMultipleChoice ? (
                <Group title="Câu nhiều lựa chọn" className="max-lg:hidden">
                  <Radio
                    size={20}
                    name="export-multi"
                    id="export-joined"
                    checked={options.multipleChoice === "joined"}
                    onChange={() => set({ multipleChoice: "joined" })}
                    label="Gộp trong một ô"
                  />
                  <Radio
                    size={20}
                    name="export-multi"
                    id="export-split"
                    checked={options.multipleChoice === "split"}
                    onChange={() => set({ multipleChoice: "split" })}
                    label="Tách mỗi lựa chọn một cột (0/1)"
                  />
                </Group>
              ) : null}
            </div>

            <Group title="Thêm cột">
              <div className="flex flex-wrap gap-x-6 gap-y-3">
                <Checkbox
                  size={20}
                  id="export-submitted"
                  checked={options.includeSubmittedAt}
                  onChange={(event) => set({ includeSubmittedAt: event.target.checked })}
                  label="Thời điểm nộp"
                />
                <Checkbox
                  size={20}
                  id="export-duration"
                  checked={options.includeDuration}
                  onChange={(event) => set({ includeDuration: event.target.checked })}
                  label="Thời gian làm"
                />
              </div>
            </Group>

            {hasMultipleChoice ? (
              <Select
                id="export-multi-mobile"
                className="lg:hidden"
                label="Câu nhiều lựa chọn"
                value={options.multipleChoice}
                onChange={(event) => set({ multipleChoice: event.target.value === "split" ? "split" : "joined" })}
                options={[
                  { value: "joined", label: "Gộp trong một ô" },
                  { value: "split", label: "Tách mỗi lựa chọn một cột (0/1)" },
                ]}
              />
            ) : null}

            <p className="flex items-start gap-2.5 rounded-field bg-tone-blue-bg px-3 py-3 text-caption leading-[19.5px] text-tone-blue-fg lg:rounded-control lg:px-3.5">
              <Icon name="lock" size={18} className="mt-0.5" />
              <span>
                <span className="max-lg:hidden">
                  File chỉ có mã ẩn danh như #{data.responses[0]?.code ?? "47AD"}, không có họ tên, email hay số điện thoại
                  của người trả lời. Bạn chỉ dùng dữ liệu cho mục đích học thuật như đã cam kết khi đăng khảo sát.
                </span>
                <span className="lg:hidden">
                  File chỉ có mã ẩn danh, không có họ tên, email hay số điện thoại. Chỉ dùng cho mục đích học thuật.
                </span>
              </span>
            </p>

            {status ? <Alert tone={status.tone}>{status.text}</Alert> : null}
            {empty ? <Alert tone="info">Chưa có câu trả lời nào để xuất với lựa chọn này.</Alert> : null}

            <div className="flex items-center gap-3">
              <p className="mr-auto text-caption text-ink-muted max-lg:hidden">{exportShape(table)}</p>
              <button
                type="button"
                onClick={close}
                className={buttonClassName({ variant: "secondary", size: "base", radius: "field", className: "max-lg:hidden" })}
              >
                Huỷ
              </button>
              <Button
                size="base"
                radius="field"
                disabled={empty}
                onClick={onDownload}
                leadingIcon={<Icon name="download" size={18} />}
                className="max-lg:h-13 max-lg:w-full max-lg:rounded-control"
              >
                Tải file {formatLabel}
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
