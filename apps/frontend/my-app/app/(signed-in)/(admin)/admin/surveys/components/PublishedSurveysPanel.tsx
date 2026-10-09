"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { PIN_FAILED, PUBLISHED_LOAD_FAILED, moderationErrorMessage } from "@/lib/admin/moderation-messages";
import { listPublishedSurveys, setSurveyPinned, type PublishedSurvey } from "@/lib/admin/published-surveys-service";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/** "Đã đăng" tab: PUBLISHED surveys, pinned first, with a Ghim / Bỏ ghim toggle. */
export function PublishedSurveysPanel() {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const list = useApiQuery(`admin:published-surveys:${search}`, (signal) => listPublishedSurveys(search, signal));
  const sessionLost = useSessionLossRedirect(list.error);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(survey: PublishedSurvey) {
    setBusyId(survey.formId);
    setError(null);
    try {
      await setSurveyPinned(survey.formId, !survey.isPinned);
      list.reload();
    } catch (cause) {
      setError(moderationErrorMessage(cause, PIN_FAILED));
    } finally {
      setBusyId(null);
    }
  }

  const items = list.data?.items;
  return (
    <div className="flex max-w-268.75 flex-col gap-4">
      <form
        role="search"
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <input
          type="search"
          aria-label="Tìm theo tên khảo sát"
          placeholder="Tìm theo tên khảo sát"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="h-10 w-full max-w-90 rounded-field border border-line bg-surface px-3 text-body-sm text-ink"
        />
        <Button type="submit" variant="secondary" size="sm" radius="field">
          Tìm
        </Button>
      </form>

      {error ? (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {list.error && !sessionLost && !items ? (
        <Alert tone="danger">
          <span>{moderationErrorMessage(list.error, PUBLISHED_LOAD_FAILED)}</span>{" "}
          <button type="button" onClick={list.reload} className="font-bold underline">
            Thử lại
          </button>
        </Alert>
      ) : !items ? (
        <div className="flex items-center gap-3 py-10 text-body-sm text-ink-muted" role="status">
          <Spinner />
          Đang tải…
        </div>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Không có khảo sát đang đăng nào{search ? " khớp tìm kiếm" : ""}.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2.5">
            {items.map((survey) => (
              <li
                key={survey.formId}
                className={[
                  "flex items-center gap-4 rounded-2xl bg-surface px-4 py-3.5",
                  survey.isPinned ? "border-2 border-primary" : "border border-line",
                ].join(" ")}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-body font-bold text-ink">
                    {survey.isPinned ? <span className="mr-2 text-caption font-extrabold text-primary">ĐÃ GHIM</span> : null}
                    {survey.title}
                  </span>
                  <span className="text-caption text-ink-muted">{survey.publisherEmail ?? "Không rõ người đăng"}</span>
                </div>
                <Button
                  variant={survey.isPinned ? "secondary" : "primary"}
                  size="sm"
                  radius="field"
                  onClick={() => toggle(survey)}
                  loading={busyId === survey.formId}
                  loadingLabel="Đang lưu…"
                  disabled={busyId !== null && busyId !== survey.formId}
                >
                  {survey.isPinned ? "Bỏ ghim" : "Ghim"}
                </Button>
              </li>
            ))}
          </ul>
          {list.data?.hasMore ? (
            <p className="text-caption text-ink-muted">
              Đang hiện {items.length}/{list.data.total} khảo sát. Dùng ô tìm kiếm để thu hẹp.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
