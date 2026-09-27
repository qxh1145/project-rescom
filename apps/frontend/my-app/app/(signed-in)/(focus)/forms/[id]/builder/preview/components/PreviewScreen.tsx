"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { validateBlockAnswer } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { useApiQuery } from "@/lib/api/use-api-query";
import { sectionOfBlock, summarizeDoc, type BuilderDoc } from "@/lib/forms/builder-blocks";
import { loadFormErrorMessage } from "@/lib/forms/builder-messages";
import { loadLocalDraft } from "@/lib/forms/builder-offline";
import { docFromForm, getBuilderForm } from "@/lib/forms/builder-service";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
// Reuses the Phase 3 respondent question card so the preview matches what respondents see.
import { QuestionCard } from "@/app/(signed-in)/(focus)/attempts/[id]/components/QuestionCard";

type Device = "phone" | "desktop";

function localDoc(formId: string): BuilderDoc | null {
  try {
    const local = loadLocalDraft(window.localStorage, formId);
    return local?.dirty ? (local.doc as BuilderDoc) : null;
  } catch {
    return null;
  }
}

/**
 * Figma 13d "Xem trước + dữ liệu chất lượng" (63:4901): one question per
 * screen inside a phone (or desktop) frame, answers are not saved; the side
 * panel shows the data-quality notice respondents accept before starting.
 * Unsaved edits kept on this device are previewed too.
 */
export function PreviewScreen() {
  const { id: formId } = useParams<{ id: string }>();
  const query = useApiQuery(`builder-preview:${formId}`, (signal) => getBuilderForm(formId, signal));
  const sessionLost = useSessionLossRedirect(query.error);
  const [device, setDevice] = useState<Device>("phone");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  if (query.loading || sessionLost) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface-muted" role="status">
        <Spinner className="size-8 text-primary" />
        <span className="sr-only">Đang tải xem trước…</span>
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-4">
        <Alert tone="danger">{loadFormErrorMessage(query.error)}</Alert>
        <Button onClick={query.reload}>Thử lại</Button>
      </main>
    );
  }

  const form = query.data;
  const doc = localDoc(formId) ?? docFromForm(form).doc;
  const summary = summarizeDoc(doc);
  const total = doc.blocks.length;
  const block = doc.blocks[Math.min(index, Math.max(0, total - 1))];
  const section = block ? sectionOfBlock(doc, block.id) : null;
  const sectionNumber = section ? doc.sections.indexOf(section) + 1 : 0;

  const next = () => {
    if (!block) return;
    const result = validateBlockAnswer(block, answers[block.id]);
    if (!result.isValid) {
      setError(answers[block.id] === undefined || answers[block.id] === "" ? "Vui lòng trả lời câu này." : "Câu trả lời chưa hợp lệ.");
      return;
    }
    setError(null);
    if (index + 1 >= total) setFinished(true);
    else setIndex(index + 1);
  };

  const restart = () => {
    setAnswers({});
    setIndex(0);
    setFinished(false);
    setError(null);
  };

  const frame =
    device === "phone"
      ? "h-[780px] w-full max-w-[390px] rounded-[40px] border-[10px] border-ink"
      : "h-[640px] w-full max-w-[720px] rounded-[20px] border border-line";

  return (
    <div className="min-h-dvh bg-surface-subtle">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-3 lg:h-17 lg:flex-nowrap lg:px-5 lg:py-0">
        <Link href={`/forms/${formId}/builder`} className={buttonClassName({ variant: "secondary", size: "md", radius: "field", className: "gap-2 text-label" })}>
          <Icon name="chevron-left" size={18} />
          Quay lại chỉnh sửa
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lead font-extrabold text-ink">Xem trước</h1>
          <p className="text-[12px] text-ink-muted">
            Bản nháp v{form.currentVersion.versionNumber} · câu trả lời lúc xem trước không được lưu
          </p>
        </div>
        <div role="group" aria-label="Thiết bị xem trước" className="hidden h-11.5 items-center gap-1 rounded-field border border-line-strong bg-surface-subtle p-1 lg:flex">
          {(
            [
              ["phone", "phone", "Điện thoại"],
              ["desktop", "monitor", "Máy tính"],
            ] as const
          ).map(([value, icon, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={device === value}
              onClick={() => setDevice(value)}
              className={`flex h-9 items-center gap-1.5 rounded-[9px] px-3.5 text-body-sm ${
                device === value ? "border border-ink bg-surface font-bold text-ink" : "font-semibold text-ink-strong"
              }`}
            >
              <Icon name={icon} size={16} />
              {label}
            </button>
          ))}
        </div>
        <Link href={`/forms/${formId}/builder/publish`} className={buttonClassName({ variant: "primary", size: "md", radius: "field", className: "gap-2 text-label" })}>
          Tiếp tục
          <Icon name="arrow-right" size={18} />
        </Link>
      </header>

      <main className="mx-auto flex max-w-[1100px] flex-col items-center gap-6 px-4 py-6 lg:flex-row lg:items-start lg:justify-center lg:gap-12 lg:py-9">
        <section aria-label="Màn hình người trả lời" className={`flex shrink-0 flex-col overflow-hidden bg-surface shadow-[0_24px_24px_rgba(30,36,70,0.12)] ${frame}`}>
          {total === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-lead font-extrabold text-ink">Form chưa có câu hỏi</p>
              <Link href={`/forms/${formId}/builder`} className="text-label font-bold text-primary">
                Quay lại thêm câu hỏi
              </Link>
            </div>
          ) : finished ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center" role="status">
              <Icon name="check-circle" size={40} className="text-primary" />
              <p className="text-lead font-extrabold text-ink">Hết phần xem trước</p>
              <p className="text-body-sm text-ink-muted">Câu trả lời lúc xem trước không được lưu và không tính điểm.</p>
              <Button variant="secondary" radius="field" size="md" onClick={restart}>
                Xem lại từ đầu
              </Button>
            </div>
          ) : (
            <>
              <div className="border-b border-line-subtle px-4.5 pt-6 pb-3.5">
                <div className="flex items-center justify-between text-[12px] font-bold">
                  <span className="text-tone-green-fg">
                    {section ? `Phần ${sectionNumber}/${doc.sections.length} · ${section.title}` : doc.title || "Khảo sát"}
                  </span>
                  <span className="text-ink-muted">
                    Câu {index + 1}/{total}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 rounded-full bg-line-subtle" aria-hidden="true">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${((index + 1) / total) * 100}%` }} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <QuestionCard
                  block={block}
                  number={index + 1}
                  value={answers[block.id]}
                  error={error ?? undefined}
                  onChange={(value) => {
                    setAnswers((current) => ({ ...current, [block.id]: value }));
                    setError(null);
                  }}
                />
              </div>
              <div className="flex gap-2.5 px-4 pt-2 pb-5">
                <Button variant="secondary" radius="field" size="lg" disabled={index === 0} onClick={() => setIndex(index - 1)}>
                  Quay lại
                </Button>
                <Button radius="field" size="lg" className="flex-1" onClick={next}>
                  {index + 1 >= total ? "Gửi (xem trước)" : "Câu tiếp theo"}
                </Button>
              </div>
            </>
          )}
        </section>

        <div className="flex w-full max-w-[420px] flex-col gap-4">
          <section className="rounded-[20px] border border-line bg-surface px-5.5 py-5">
            <h2 className="text-lead font-extrabold text-ink">Người trả lời thấy gì trước khi làm</h2>
            <p className="mt-3 text-body-sm leading-[22px] text-ink-muted">
              {summary.questionCount} câu · khoảng {summary.minutes} phút · thưởng theo mức bạn đặt ở bước 3. Trước câu đầu tiên, Rescom hiện thông báo về dữ liệu chất lượng bên dưới để người trả lời đồng ý.
            </p>
          </section>
          <section aria-labelledby="quality-title" className="rounded-[20px] border border-line bg-surface px-5.5 py-5">
            <h2 id="quality-title" className="flex gap-2 text-lead font-extrabold text-ink">
              <Icon name="shield-check" size={18} className="mt-0.5 text-tone-amber-strong" />
              Dữ liệu chất lượng form này có thể thu thập
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {[
                ["Thời gian", "Lúc hiện câu hỏi, lúc trả lời, tổng thời gian nộp bài"],
                ["Tương tác", "Chọn hoặc đổi đáp án, chuyển câu, lỗi nhập liệu"],
                ["Mức tập trung", "Rời khỏi hoặc quay lại trang khảo sát"],
                [
                  "Chú ý",
                  summary.attentionNumbers.length > 0
                    ? `${summary.attentionNumbers.length} câu kiểm tra chú ý (câu ${summary.attentionNumbers.join(", ")})`
                    : "Không có câu kiểm tra chú ý",
                ],
              ].map(([title, text]) => (
                <li key={title} className="flex gap-2.5">
                  <Icon name="check-circle" size={18} className="mt-px text-tone-teal-fg" />
                  <span>
                    <span className="block text-body-sm font-bold text-ink">{title}</span>
                    <span className="block text-caption leading-[18.9px] text-ink-muted">{text}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-4 flex gap-2.5 rounded-[12px] bg-surface-muted px-3 py-3 text-caption leading-[19.5px] text-ink-strong">
              <Icon name="padlock" size={16} className="mt-0.5 shrink-0" />
              <span>
                <b>Không bao giờ thu thập:</b> nội dung gõ phím, clipboard, hoạt động ngoài form.
                {doc.blocks.some((b) => b.integrity?.consistencyPair) ? " Có quy tắc nhất quán giữa các câu." : " Chưa có quy tắc nhất quán nào."}
              </span>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
