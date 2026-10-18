"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextField } from "@/components/ui/TextField";
import { isApiError } from "@/lib/api/api-error";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getRewardsSettings, updateRewardsSettings } from "@/lib/admin/rewards-vouchers-service";
import { parseDailyLimitInput, rewardsSettingsErrorMessage } from "@/lib/admin/rewards-vouchers-view";

const points = (value: number) => `${value.toLocaleString("vi-VN")} Điểm`;

/** FR-74: Admin-editable per-user daily Points redemption limit (backend Story 12.8 task 4.6). */
export function DailyPointsLimitCard() {
  const query = useApiQuery("admin:rewards:settings", getRewardsSettings);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState<number | null>(null);
  // Rewards disabled on the backend (RewardsEnabledGuard): no card, no error.
  if (isApiError(query.error) && query.error.status === 404) return null;

  const current = query.data?.dailyPointsLimit;
  const parsed = draft === null ? null : parseDailyLimitInput(draft);
  const next = parsed && "value" in parsed ? parsed.value : null;

  async function save() {
    if (next === null) return;
    setBusy(true); setSaveError("");
    try {
      const result = await updateRewardsSettings({ dailyPointsLimit: next });
      query.setData(() => result);
      setSaved(result.dailyPointsLimit);
      setConfirming(false);
      setDraft(null);
    } catch (error) {
      setSaveError(rewardsSettingsErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="space-y-4 rounded-card border border-line bg-surface p-5" aria-labelledby="daily-points-limit-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="daily-points-limit-title" className="font-bold">Giới hạn Điểm đổi mỗi ngày</h2>
        <p className="text-body-sm text-ink-muted">Tổng Điểm một người được dùng để đổi voucher trong một ngày (giờ Việt Nam).</p>
      </div>
      {current !== undefined && draft === null && <Button variant="secondary" onClick={() => { setDraft(String(current)); setSaved(null); }}>Sửa</Button>}
    </div>
    {query.loading && current === undefined && <div className="h-12 animate-pulse rounded-field bg-surface-subtle" aria-label="Đang tải giới hạn" />}
    {query.error && <div className="flex gap-3"><Alert tone="danger">Không tải được giới hạn.</Alert><Button onClick={query.reload}>Thử lại</Button></div>}
    {saved !== null && <Alert tone="info">Đã cập nhật giới hạn: {points(saved)} / người / ngày.</Alert>}
    {current !== undefined && (draft === null
      ? <p><strong className="text-title-sm">{current.toLocaleString("vi-VN")}</strong> Điểm / người / ngày</p>
      : <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); if (next !== null && next !== current) { setSaveError(""); setConfirming(true); } }}>
        <TextField id="daily-points-limit" label="Giới hạn mới (Điểm)" inputMode="numeric" autoComplete="off" value={draft} onChange={(event) => setDraft(event.target.value)} error={parsed && "error" in parsed ? parsed.error : undefined} className="min-w-60" />
        <Button variant="secondary" onClick={() => setDraft(null)}>Huỷ</Button>
        <Button type="submit" disabled={next === null || next === current}>Lưu</Button>
      </form>)}
    <Dialog open={confirming} labelledBy="daily-points-limit-confirm" onClose={() => !busy && setConfirming(false)} dismissible={!busy}><div className="space-y-4 p-6">
      <h2 id="daily-points-limit-confirm" className="text-title-sm font-bold">Đổi giới hạn Điểm mỗi ngày?</h2>
      {current !== undefined && next !== null && <p className="text-title-sm">{current.toLocaleString("vi-VN")} → {points(next)}</p>}
      <p>Áp dụng từ lần đổi tiếp theo; các lượt đổi đã xong không bị ảnh hưởng.</p>
      {saveError && <Alert tone="danger">{saveError}</Alert>}
      <div className="flex gap-3"><Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Huỷ</Button><Button disabled={busy} onClick={() => void save()}>Xác nhận</Button></div>
    </div></Dialog>
  </section>;
}
