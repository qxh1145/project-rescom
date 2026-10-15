"use client";
import { useRef, useState } from "react";
import type { AdminCodeIssueDto, AdminResolveCodeIssueDto } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Textarea } from "@/components/ui/Textarea";
import { noteState, PRICE_SOURCE_LABELS, resolveBody, resolveErrorView } from "@/lib/admin/rewards-code-issues-view";
import { resolveAdminCodeIssue } from "@/lib/admin/rewards-code-issues-service";

type Outcome = AdminResolveCodeIssueDto["outcome"];
export function ResolveCodeIssueDialog({ issue, outcome, onClose, onSuccess, onResult, onMissing, onSwitch }: {
  issue: AdminCodeIssueDto; outcome: Outcome; onClose: () => void; onSuccess: () => void;
  onResult: () => void; onMissing: () => void; onSwitch: (outcome: Outcome) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const sending = useRef(false);
  const state = noteState(outcome, note);
  const view = error ? resolveErrorView(error, issue) : null;
  const title = outcome === "REPLACE" ? `Thay mã cho ${issue.reference}?` : outcome === "REFUND" ? `Hoàn ${issue.pricePoints} điểm cho user ${issue.userLabel}?` : `Từ chối báo cáo ${issue.reference}?`;
  const confirm = outcome === "REPLACE" ? "Thay mã" : outcome === "REFUND" ? `Hoàn ${issue.pricePoints} điểm` : "Từ chối báo cáo";
  async function submit() {
    if (sending.current || !state.valid) return;
    sending.current = true; setBusy(true); setError(null);
    try { await resolveAdminCodeIssue(issue.id, resolveBody(outcome, note)); onSuccess(); }
    catch (cause) { setError(cause); if (resolveErrorView(cause, issue).code === "CODE_ISSUE_NOT_FOUND") onMissing(); }
    finally { sending.current = false; setBusy(false); }
  }
  return <Dialog open onClose={onClose} labelledBy="code-issue-resolve-title" width={480} dismissible={!busy}>
    <div className="flex items-start justify-between border-b border-line p-5"><div><h2 id="code-issue-resolve-title" className="text-xl font-extrabold">{title}</h2><p className="mt-1 text-ink-muted">{outcome === "REPLACE" ? `User ${issue.userLabel} · ${issue.voucher.title} · ${issue.voucher.brand.name}` : outcome === "REFUND" ? `${issue.reference} · ${issue.voucher.title} · giá ${PRICE_SOURCE_LABELS[issue.priceSource]}` : "Không thay mã, không hoàn điểm."}</p></div><IconButton icon="x" label="Đóng" disabled={busy} onClick={onClose} /></div>
    <div className="grid gap-4 p-5"><div className="rounded-field bg-surface-subtle p-4"><strong>Điều sẽ xảy ra</strong><ul className="mt-2 list-disc space-y-1 pl-5 text-body-sm">
      {(outcome === "REPLACE" ? ["Dùng 1 đơn vị tồn kho và cấp 1 mã mới chưa phát.", "Mã cũ không được phát lại cho người khác.", "Ticket giữ hạn dùng và chuyển về “Chưa dùng”. User nhận thông báo in-app “Báo cáo đã được xử lý”."] : outcome === "REFUND" ? [`+${issue.pricePoints} điểm về ví Khả dụng của user — đúng số điểm đã trừ.`, `Ghi bút toán đảo cho giao dịch ${issue.reference}.`, "Tồn kho không được trả lại.", "Ticket chuyển sang “Đã hoàn điểm”. User nhận thông báo in-app.", <strong key="undo">Không thể hoàn tác.</strong>] : ["Ticket giữ nguyên, user dùng tiếp được và có thể báo lại nếu vẫn lỗi.", "User sẽ thấy nguyên văn lý do bên dưới trong thông báo."]).map((line, index) => <li key={index}>{line}</li>)}
    </ul></div><div><label htmlFor="code-issue-note" className="text-label font-semibold text-ink">{outcome === "REJECT" ? <>Lý do từ chối <span className="text-danger">* bắt buộc</span></> : "Ghi chú nội bộ · không bắt buộc"}</label><Textarea id="code-issue-note" placeholder={outcome === "REJECT" ? "Giải thích vì sao báo cáo không được chấp nhận và user nên làm gì tiếp…" : "VD: Lô t10 lỗi định dạng, đã báo đối tác"} value={note} onChange={event => setNote(event.target.value)} disabled={busy} /><p className={state.overBy ? "text-danger" : "text-ink-muted"}>{state.helper} <span className="float-right">{state.counter}</span></p></div>
      {view && <Alert tone="danger"><strong>{view.title}</strong><br />{view.body}<br />Mã lỗi: {view.code}</Alert>}
      {busy && <p role="status">Đang gửi… Không đóng cửa sổ. Nếu mất mạng, bấm lại an toàn — mỗi báo cáo chỉ được xử lý một lần.</p>}
    </div><div className="flex flex-wrap justify-end gap-2 border-t border-line p-5"><Button variant="secondary" disabled={busy} onClick={onClose}>Huỷ</Button>
      {view?.suggest && <Button variant="outline" onClick={() => onSwitch("REFUND")}>Hoàn điểm</Button>}
      {view?.suggest === "REFUND_OR_REJECT" && <Button variant="ghost" onClick={() => onSwitch("REJECT")}>Từ chối</Button>}
      {view?.showResult ? <Button onClick={onResult}>Xem kết quả</Button> : <Button disabled={!state.valid || busy} loading={busy} loadingLabel="Đang gửi…" onClick={submit}>{view ? "Thử lại" : confirm}</Button>}
    </div>
  </Dialog>;
}
