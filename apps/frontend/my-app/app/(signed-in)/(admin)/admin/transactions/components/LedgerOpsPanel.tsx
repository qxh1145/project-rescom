"use client";

import { Fragment, type FormEvent, type ReactNode } from "react";
import { LEDGER_DRIFT_REPORT_LIMIT, MATURED_PENDING_RELEASE_MAX_LIMIT } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Tag } from "@/components/ui/Tag";
import { TextField } from "@/components/ui/TextField";
import {
  REDRIVE_TARGETS,
  RELEASE_DEFAULT_LIMIT,
  accountClassLabel,
  ownerLabel,
  settlementStatusLabel,
} from "@/lib/admin/ledger-ops-view";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatPoints } from "@/lib/wallet/top-up";
import { useLedgerOps } from "../hooks/use-ledger-ops";
import { ConfirmOpDialog } from "./ConfirmOpDialog";

const CARD = "rounded-[22px] border border-line bg-surface px-6 pt-5 pb-5.5";

const points = (value: number) => `${formatPoints(value)} Điểm`;

function Card({ id, title, intro, children }: { id: string; title: string; intro: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className={CARD}>
      <h2 id={id} className="text-title-sm font-extrabold text-ink">
        {title}
      </h2>
      <p className="mt-1 text-body-sm text-ink-muted">{intro}</p>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-body-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="font-semibold break-all text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Story 14.4 "Vận hành": the ledger operator fallbacks as buttons. No Figma frame
 * (sprint-change-proposal-2026-10-18 D3): built from the shared admin components.
 * Every mutating action goes through `ConfirmOpDialog`.
 */
export function LedgerOpsPanel() {
  const ops = useLedgerOps();
  const locked = ops.busy || ops.pending !== null || ops.integrityLoading;

  function submit(event: FormEvent, request: () => void) {
    event.preventDefault();
    request();
  }

  const redriveNoun = ops.redriveTarget === "internal" ? "bài trả lời" : "lượt làm";
  const outcome = ops.redriveOutcome;
  const release = ops.releaseOutcome?.summary;

  return (
    <div className="flex flex-col gap-5">
      <Card
        id="ops-integrity-title"
        title="Kiểm tra toàn vẹn sổ cái"
        intro="Kiểm tra tổng các bút toán và tìm tài khoản có số dư hiển thị lệch so với bút toán. Chỉ đọc, không thay đổi dữ liệu."
      >
        <div className="mt-4">
          <Button variant="secondary" size="base" radius="field" onClick={() => void ops.runIntegrity()} loading={ops.integrityLoading} loadingLabel="Đang kiểm tra…">
            Chạy kiểm tra
          </Button>
        </div>
        {ops.integrityError ? (
          <Alert tone="danger" className="mt-4">
            {ops.integrityError}
          </Alert>
        ) : null}
        <div aria-live="polite" className="mt-4 flex flex-col gap-3">
          {ops.report ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink">
                <Tag tone={ops.report.isZeroSum ? "green" : "danger"}>
                  {ops.report.isZeroSum ? "Tổng bút toán bằng 0" : "Tổng bút toán khác 0"}
                </Tag>
                <span>Tổng số dư toàn hệ thống: {points(ops.report.totalSystemBalance)}</span>
              </p>
              {!ops.report.isZeroSum ? (
                <Alert tone="danger">
                  Các bút toán không cân bằng (tổng khác 0). Đối soát chỉ tính lại số dư hiển thị, không sửa được lỗi này.
                </Alert>
              ) : null}
              {ops.report.driftedAccounts.length === 0 ? (
                <p className="text-body-sm text-ink-muted">Không có tài khoản nào lệch số dư.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-175 border-collapse text-left">
                    <caption className="sr-only">Tài khoản lệch số dư</caption>
                    <thead>
                      <tr className="text-caption text-ink-muted">
                        <th scope="col" className="h-9 border-b border-line font-semibold">Chủ tài khoản</th>
                        <th scope="col" className="h-9 border-b border-line font-semibold">Loại</th>
                        <th scope="col" className="h-9 border-b border-line text-right font-semibold">Số dư hiển thị</th>
                        <th scope="col" className="h-9 border-b border-line text-right font-semibold">Số dư tính từ bút toán</th>
                        <th scope="col" className="h-9 border-b border-line text-right font-semibold">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="text-body-sm text-ink">
                      {ops.report.driftedAccounts.map((account) => {
                        const verification = ops.verifications[account.accountId];
                        const verifyError = ops.verifyErrors[account.accountId];
                        const name = `${ownerLabel(account.userId)} · ${accountClassLabel(account.accountClass)}`;
                        return (
                          <Fragment key={account.accountId}>
                            <tr className="border-b border-line">
                              <td className="py-2.5 font-semibold">{ownerLabel(account.userId)}</td>
                              <td className="py-2.5">{accountClassLabel(account.accountClass)}</td>
                              <td className="py-2.5 text-right">{points(account.projectedBalance)}</td>
                              <td className="py-2.5 text-right">{points(account.calculatedBalance)}</td>
                              <td className="py-2.5">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    radius="field"
                                    aria-label={`Kiểm tra số dư tài khoản ${name}`}
                                    onClick={() => void ops.verifyAccount(account.accountId)}
                                    loading={ops.verifyingId === account.accountId}
                                    loadingLabel="Đang kiểm tra…"
                                    disabled={ops.verifyingId !== null || locked}
                                  >
                                    Kiểm tra số dư
                                  </Button>
                                  <Button
                                    size="sm"
                                    radius="field"
                                    aria-label={`Đối soát tài khoản ${name}`}
                                    onClick={() => ops.requestReconcile(account)}
                                    disabled={locked}
                                  >
                                    Đối soát
                                  </Button>
                                </div>
                              </td>
                            </tr>
                            {verification || verifyError ? (
                              <tr className="border-b border-line">
                                <td colSpan={5} className="pb-2.5 text-body-sm">
                                  {verifyError ? (
                                    <span className="text-danger">{verifyError}</span>
                                  ) : verification ? (
                                    <span>
                                      Số dư hiển thị {points(verification.projectedBalance)}, tính từ bút toán{" "}
                                      {points(verification.calculatedBalance)}:{" "}
                                      <strong>{verification.isConsistent ? "khớp" : "lệch"}</strong>.
                                    </span>
                                  ) : null}
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {ops.report.driftedAccountsTruncated ? (
                <Alert tone="info">
                  Chỉ hiện {LEDGER_DRIFT_REPORT_LIMIT} tài khoản đầu tiên. Đối soát rồi chạy kiểm tra lại để xem tiếp.
                </Alert>
              ) : null}
            </>
          ) : null}
          {ops.reconciled.map(({ account, result }, index) => (
            <p key={`${result.accountId}-${index}`} className="text-body-sm text-ink">
              Đã đối soát tài khoản {ownerLabel(account.userId)} · {accountClassLabel(account.accountClass)}:{" "}
              <strong>
                {points(result.priorBalance)} → {points(result.correctedBalance)}
              </strong>
              .
            </p>
          ))}
        </div>
      </Card>

      <Card
        id="ops-redrive-title"
        title="Chạy lại trả thưởng"
        intro="Chạy lại việc trả thưởng cho một bài trả lời hoặc lượt làm bị kẹt. Chạy nhiều lần vẫn chỉ trả một lần."
      >
        <form noValidate onSubmit={(event) => submit(event, ops.requestRedrive)} className="mt-4 flex flex-col gap-4">
          <SegmentedControl
            label="Loại mã"
            segments={REDRIVE_TARGETS}
            value={ops.redriveTarget}
            onChange={ops.setRedriveTarget}
            variant="bordered"
          />
          <TextField
            id="redrive-id"
            label={`Mã ${redriveNoun}`}
            hint="Mã dạng UUID."
            error={ops.redriveIdError}
            value={ops.redriveIdText}
            onChange={(event) => ops.setRedriveIdText(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="max-w-xl"
          />
          <div>
            <Button type="submit" variant="secondary" size="base" radius="field" disabled={locked}>
              Chạy lại
            </Button>
          </div>
        </form>
        <div aria-live="polite" className="mt-4">
          {outcome ? (
            outcome.result ? (
              <Facts
                rows={[
                  ["Trạng thái", settlementStatusLabel(outcome.result.status)],
                  ["Số Điểm", points(outcome.result.amount)],
                  ["Tài khoản nhận", outcome.result.targetAccountClass ? accountClassLabel(outcome.result.targetAccountClass) : "—"],
                  ["Mã bút toán", outcome.result.journalId ?? "—"],
                  ["Thời điểm", formatShortDateTime(outcome.result.settledAt)],
                ]}
              />
            ) : (
              <p className="text-body-sm text-ink-muted">Chưa có kết quả trả thưởng.</p>
            )
          ) : null}
        </div>
      </Card>

      <Card
        id="ops-release-title"
        title="Giải phóng Điểm chờ đã đủ 48 giờ"
        intro="Chuyển các khoản thưởng đã chờ quá 48 giờ sang Khả dụng. Khoản đang bị khiếu nại được giữ lại."
      >
        <form noValidate onSubmit={(event) => submit(event, ops.requestRelease)} className="mt-4 flex flex-col gap-4">
          <TextField
            id="release-limit"
            label="Giới hạn số khoản (tuỳ chọn)"
            hint={`Số nguyên từ 1 đến ${MATURED_PENDING_RELEASE_MAX_LIMIT}. Để trống = tối đa ${RELEASE_DEFAULT_LIMIT}.`}
            error={ops.limitError}
            value={ops.limitText}
            onChange={(event) => ops.setLimitText(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
            className="max-w-xl"
          />
          <div>
            <Button type="submit" variant="secondary" size="base" radius="field" disabled={locked}>
              Giải phóng
            </Button>
          </div>
        </form>
        <div aria-live="polite" className="mt-4">
          {release ? (
            <>
              <Facts
                rows={[
                  ["Đã xử lý", String(release.processed)],
                  ["Đã giải phóng", String(release.releasedCount)],
                  ["Đang khiếu nại, giữ lại", String(release.disputedCount)],
                  ["Lỗi", String(release.failedCount)],
                  ["Mốc 48 giờ", formatShortDateTime(release.cutoffDate)],
                  ["Còn khoản chưa xử lý", release.hasMore ? "Có" : "Không"],
                ]}
              />
              {release.hasMore && release.nextCursor ? (
                <div className="mt-3">
                  <Button variant="secondary" size="base" radius="field" onClick={ops.requestContinue} disabled={locked}>
                    Chạy tiếp
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Card>

      <ConfirmOpDialog action={ops.pending} busy={ops.busy} error={ops.error} onCancel={ops.cancel} onConfirm={() => void ops.confirm()} />
    </div>
  );
}
