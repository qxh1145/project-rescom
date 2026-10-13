"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { adminFlashSaleInputSchema, type AdminFlashSaleInputDto, type AdminVoucherListDto } from "@rescom/schemas";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { FlashSaleCard } from "@/app/(signed-in)/(app)/rewards/components/FlashSaleCard";
import { Countdown } from "@/app/(signed-in)/(app)/rewards/components/Countdown";
import { createAdminFlashSale, updateAdminFlashSale } from "@/lib/admin/rewards-flash-service";
import { listAdminVouchers } from "@/lib/admin/rewards-vouchers-service";
import { flashFormErrors, previewFlashItem } from "@/lib/admin/rewards-flash-view";
import { ApiError } from "@/lib/api/api-error";
import { vietnamDateTimeParts } from "@/lib/format/date-time";
import { useAdminFlashSale } from "../hooks/use-admin-flash-sales";

const CAP_OPTIONS = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} suất` }));
type Row = AdminFlashSaleInputDto["items"][number];
type Voucher = AdminVoucherListDto["items"][number];
const initial = (): AdminFlashSaleInputDto => ({ title: "", startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 4 * 3600000).toISOString(), rules: { requireRecentSurvey: true, remindBefore10m: true, blockFlagged: true }, items: [] });
function localDate(value: string) { const parts = vietnamDateTimeParts(value); return parts ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` : ""; }
function vietnamIso(value: string) { const date = new Date(`${value.slice(0, 16)}:00+07:00`); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); }

/** Flatten Zod error.format() into field paths without trusting unknown server details. */
function zodFormattedIssues(details: unknown): { path: (string | number)[]; message: string }[] {
  const result: { path: (string | number)[]; message: string }[] = [];
  function visit(node: unknown, path: (string | number)[]) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record._errors)) {
      for (const message of record._errors) if (typeof message === "string") result.push({ path, message });
    }
    for (const [key, value] of Object.entries(record)) if (key !== "_errors") visit(value, [...path, /^\d+$/.test(key) ? Number(key) : key]);
  }
  visit(details, []);
  return result;
}

export function FlashSaleFormScreen({ id }: { id?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const detail = useAdminFlashSale(id);
  const [form, setForm] = useState<AdminFlashSaleInputDto>(initial);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [device, setDevice] = useState<"Mobile" | "Desktop">("Mobile");
  const [state, setState] = useState<"UPCOMING" | "ACTIVE">("UPCOMING");
  useEffect(() => {
    listAdminVouchers({ filter: "ACTIVE" }).then((data) => setVouchers(data.items)).catch(() => setFailure("Không tải được danh sách voucher."));
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (id && detail.data && !loaded) {
    const flash = detail.data.flashSale;
    setForm({ title: flash.title, startsAt: flash.startsAt, endsAt: flash.endsAt, rules: flash.rules, items: flash.items.map((item) => ({ voucherId: item.voucherId, flashPoints: item.flashPoints, quota: item.quota, perUserCap: item.perUserCap })) });
    setLoaded(true);
  }
  const voucherId = search.get("voucherId");
  if (!id && voucherId && vouchers.some((voucher) => voucher.id === voucherId) && !loaded) {
    setForm((old) => ({ ...old, items: [{ voucherId, flashPoints: 0, quota: 1, perUserCap: 1 }] }));
    setLoaded(true);
  }
  const update = <K extends keyof AdminFlashSaleInputDto>(key: K, value: AdminFlashSaleInputDto[K]) => { setForm((old) => ({ ...old, [key]: value })); setErrors((old) => ({ ...old, [key]: "" })); };
  const updateRow = (index: number, patch: Partial<Row>) => update("items", form.items.map((row, i) => i === index ? { ...row, ...patch } : row));
  const field = (key: string) => ({ "aria-invalid": Boolean(errors[key]) || undefined, "aria-describedby": errors[key] ? `flash-error-${key.replaceAll(".", "-")}` : undefined });
  const error = (key: string) => errors[key] ? <p role="alert" id={`flash-error-${key.replaceAll(".", "-")}`} className="text-caption text-danger">{errors[key]}</p> : null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const parsed = adminFlashSaleInputSchema.safeParse(form);
    if (!parsed.success) { setErrors(flashFormErrors(parsed.error.issues)); return; }
    setBusy(true); setErrors({}); setFailure("");
    try {
      if (id) await updateAdminFlashSale(id, parsed.data);
      else await createAdminFlashSale(parsed.data);
      router.push("/admin/flash-sales");
    } catch (cause) {
      if (!(cause instanceof ApiError)) { setFailure("Không lưu được Flash Sale. Kiểm tra kết nối và thử lại."); }
      else if (cause.code === "FLASH_ALREADY_STARTED") { setFailure("Flash Sale đã bắt đầu nên không thể sửa nữa. Đã tải lại chương trình."); detail.reload(); }
      else if (cause.status === 404) { setFailure("Không tìm thấy Flash Sale này (có thể đã bị xoá). Quay lại danh sách để xem chương trình hiện có."); }
      else {
        const details = cause.details as { conflicts?: { path: string; code: string; details?: Record<string, unknown> }[]; issues?: { path: (string | number)[]; message: string }[] } | null;
        const conflicts = Array.isArray(details?.conflicts) ? details.conflicts : [];
        const issues = Array.isArray(cause.details) ? cause.details as { path: (string | number)[]; message: string }[] : details?.issues ?? [];
        const formatted = cause.code === "VALIDATION_ERROR" ? zodFormattedIssues(cause.details) : [];
        const fieldErrors = flashFormErrors([...issues, ...formatted], conflicts);
        setErrors(fieldErrors);
        setFailure(Object.keys(fieldErrors).length ? "Không lưu được Flash Sale. Kiểm tra các trường và thử lại." : "Không lưu được Flash Sale. Thử lại sau.");
      }
    } finally { setBusy(false); }
  }
  return <AdminPage title={id ? "Sửa Flash Sale" : "Tạo Flash Sale"} meta={<Link href="/admin/flash-sales" className="text-primary">Flash Sale{detail.data && id ? ` › ${detail.data.flashSale.code}` : ""}</Link>} actions={<><Link href="/admin/flash-sales" className="rounded-field border border-line p-2">Huỷ</Link><button type="submit" form="flash-form" disabled={busy} className="rounded-field bg-primary px-5 py-2 font-bold text-white disabled:opacity-50">{id ? "Lưu" : "Lên lịch"}</button></>}>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form id="flash-form" onSubmit={(event) => void submit(event)} className="space-y-6">
        {failure && <Alert tone="danger">{failure}</Alert>}{id && detail.error && <Alert tone="danger">{detail.error.status === 404 ? "Không tìm thấy Flash Sale này." : "Không tải được Flash Sale."} {detail.error.status !== 404 && <Button onClick={detail.reload}>Thử lại</Button>}</Alert>}
        <section className="space-y-4 rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Chương trình</h2><label className="block">Tên chương trình<input maxLength={60} className="mt-1 w-full rounded-field border border-line p-3" value={form.title} onChange={(event) => update("title", event.target.value)} {...field("title")} /></label>{error("title")}<div className="grid grid-cols-2 gap-4">{(["startsAt", "endsAt"] as const).map((key) => <label key={key} className="block">{key === "startsAt" ? "Bắt đầu" : "Kết thúc"}<input type="datetime-local" className="mt-1 w-full rounded-field border border-line p-3" value={localDate(form[key])} onChange={(event) => update(key, vietnamIso(event.target.value))} {...field(key)} />{error(key)}</label>)}</div><p className="text-ink-muted">Tối đa 6 giờ. Không trùng giờ với Flash Sale khác có cùng voucher.</p></section>
        <section className="space-y-4 rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Voucher tham gia</h2><label className="block">Thêm voucher<select className="mt-1 w-full rounded-field border border-line p-3" value="" onChange={(event) => { const voucher = vouchers.find((item) => item.id === event.target.value); if (voucher) update("items", [...form.items, { voucherId: voucher.id, flashPoints: 0, quota: 1, perUserCap: 1 }]); }}><option value="">Chọn voucher</option>{vouchers.filter((voucher) => !form.items.some((row) => row.voucherId === voucher.id)).map((voucher) => <option value={voucher.id} key={voucher.id}>{voucher.title}</option>)}</select></label>{error("items")}{form.items.map((row, index) => { const voucher = vouchers.find((item) => item.id === row.voucherId); return <div key={`${row.voucherId}-${index}`} className="rounded-field border border-line p-4"><div className="flex justify-between"><strong>{voucher?.title ?? row.voucherId}</strong><button type="button" className="text-danger" onClick={() => update("items", form.items.filter((_, i) => i !== index))}>Xoá</button></div><p className="text-ink-muted">{voucher ? `Giá thường ${voucher.promoPoints ?? voucher.basePoints} điểm · còn ${voucher.stock.remaining} mã chưa giữ` : "Đang tải voucher…"}</p>{error(`items.${index}.voucherId`)}<div className="mt-3 grid grid-cols-3 gap-3">{(["flashPoints", "quota"] as const).map((key) => <label key={key}>{({ flashPoints: "Giá Flash", quota: "Số suất" })[key]}<input type="number" min={1} className="mt-1 w-full rounded-field border border-line p-2" value={row[key]} onChange={(event) => updateRow(index, { [key]: Number(event.target.value) })} {...field(`items.${index}.${key}`)} />{error(`items.${index}.${key}`)}</label>)}<div><Select id={`flash-cap-${index}`} label="Mỗi người" height={44} options={CAP_OPTIONS} value={String(row.perUserCap)} onChange={(event) => updateRow(index, { perUserCap: Number(event.target.value) })} />{error(`items.${index}.perUserCap`)}</div></div></div>; })}</section>
        <section className="space-y-3 rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Điều kiện & thông báo</h2><Toggle checked disabled onCheckedChange={() => {}} label="Chỉ tài khoản đã kích hoạt" />{([ ["requireRecentSurvey", "Chỉ người đã làm ≥ 1 khảo sát trong 30 ngày"], ["remindBefore10m", "Báo trước 10 phút cho người bấm Nhắc tôi"], ["blockFlagged", "Chặn tài khoản đang bị gắn cờ FraudLog"] ] as const).map(([key, label]) => <Toggle key={key} checked={form.rules[key]} onCheckedChange={(checked) => update("rules", { ...form.rules, [key]: checked })} label={label} />)}<p className="text-ink-muted">Khi kết thúc, giá và suất chưa đổi trở về voucher thường.</p></section>
      </form>
      <aside className="h-fit space-y-4 rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Xem trước trên User Portal</h2><div className="flex gap-2">{(["Mobile", "Desktop"] as const).map((name) => <button key={name} type="button" aria-pressed={device === name} onClick={() => setDevice(name)} className="rounded-field border border-line px-3 py-2">{name}</button>)}</div><div className="flex gap-2">{(["UPCOMING", "ACTIVE"] as const).map((name) => <button key={name} type="button" aria-pressed={state === name} onClick={() => setState(name)} className="rounded-field border border-line px-3 py-2">{name === "UPCOMING" ? "Sắp diễn ra" : "Đang diễn ra"}</button>)}</div><div className={`space-y-3 rounded-card border border-line p-3 ${device === "Mobile" ? "mx-auto max-w-[280px]" : ""}`}><Countdown endsAt={state === "UPCOMING" ? form.startsAt : form.endsAt} nowMs={now} kind={state === "UPCOMING" ? "starts" : "ends"} />{form.items.map((row) => { const item = previewFlashItem(row, vouchers.find((voucher) => voucher.id === row.voucherId), state); return item && <FlashSaleCard key={row.voucherId} item={item} startsAt={form.startsAt} nowMs={now} />; })}</div><p className="text-caption text-ink-muted">Xem trước chỉ minh hoạ. Giá, tồn kho và trạng thái do máy chủ xác định.</p></aside>
    </div>
  </AdminPage>;
}
