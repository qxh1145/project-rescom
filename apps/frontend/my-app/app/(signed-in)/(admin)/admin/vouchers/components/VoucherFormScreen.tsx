"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { adminVoucherInputSchema, type VoucherBrandDto } from "@rescom/schemas";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { VoucherCard } from "@/app/(signed-in)/(app)/rewards/components/VoucherCard";
import { createAdminVoucher, updateAdminVoucher, changeAdminVoucherPrice, importAdminVoucherCodes, listAdminVoucherBrands } from "@/lib/admin/rewards-vouchers-service";
import { deviationWarning, parseCodeCsv, preCheckItems, voucherFormErrors } from "@/lib/admin/rewards-vouchers-view";
import { ApiError } from "@/lib/api/api-error";
import { vietnamDateTimeParts } from "@/lib/format/date-time";
import { useAdminVoucher } from "../hooks/use-admin-voucher";

type Form = typeof adminVoucherInputSchema._output;
function codesSummary(codes: string[]) { return `${codes.slice(0, 20).join(", ")}${codes.length > 20 ? ` và ${codes.length - 20} mã khác` : ""}`; }
const makeInitial = (): Form => ({ title: "", brandId: "", category: "COFFEE", valueVnd: 50000, basePoints: 250, promoPoints: null, isSharedCode: false, redeemStartsAt: new Date().toISOString(), redeemEndsAt: new Date(Date.now() + 30 * 86400000).toISOString(), codeExpiresAt: new Date(Date.now() + 38 * 86400000).toISOString(), terms: [], howToUse: [], imageUrl: null });
function localDate(value: string) { const p = vietnamDateTimeParts(value); return p ? `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` : ""; }
function vietnamIso(value: string) { const date = new Date(`${value.slice(0, 16)}:00+07:00`); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
type Step = "update" | "price" | "codes";
const STEP_LABELS: Record<Step, string> = { update: "thông tin", price: "giá điểm", codes: "mã" };

export function VoucherFormScreen({ id }: { id?: string }) {
  const router = useRouter();
  const detail = useAdminVoucher(id);
  const [brands, setBrands] = useState<VoucherBrandDto[]>([]);
  const [form, setForm] = useState<Form>(makeInitial);
  const [loadedId, setLoadedId] = useState<string>();
  const [csv, setCsv] = useState<ReturnType<typeof parseCodeCsv>>();
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof importAdminVoucherCodes>>>();
  const [checking, setChecking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [done, setDone] = useState<Step[]>([]);
  useEffect(() => { listAdminVoucherBrands().then((result) => setBrands(result.items)).catch(() => setFailure("Không tải được thương hiệu.")); }, []);
  if (id && detail.data && loadedId !== id) { const v = detail.data.voucher; setForm({ title: v.title, brandId: v.brand.id, category: v.category, valueVnd: v.valueVnd, basePoints: v.basePoints, promoPoints: v.promoPoints, isSharedCode: v.isSharedCode, redeemStartsAt: v.redeemStartsAt, redeemEndsAt: v.redeemEndsAt, codeExpiresAt: v.codeExpiresAt, terms: [], howToUse: [], imageUrl: null }); setLoadedId(id); }
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm((old) => ({ ...old, [key]: value })); setFieldErrors((old) => Object.fromEntries(Object.entries(old).filter(([name]) => name !== key))); };
  const errorOf = (key: string) => fieldErrors[key] ? <span id={`error-${key}`} role="alert" className="block text-danger">{fieldErrors[key]}</span> : null;
  const describe = (key: string) => fieldErrors[key] ? { "aria-invalid": true as const, "aria-describedby": `error-${key}` } : {};
  async function upload(file?: File) {
    setValidation(undefined); setCsv(undefined);
    if (!file) return;
    setChecking(true);
    try { const parsed = parseCodeCsv(await file.text()); setCsv(parsed); if (parsed.invalid.length || !parsed.codes.length) return; if (id || createdId) setValidation(await importAdminVoucherCodes(id ?? createdId ?? "", { codes: parsed.codes, mode: "VALIDATE" })); else setValidation({ received: parsed.codes.length, accepted: parsed.codes.length, duplicatesInFile: [...new Set(parsed.codes.filter((code, i) => parsed.codes.indexOf(code) !== i))], alreadyStored: [], committed: false }); }
    catch { setFailure("Không kiểm tra được mã. Thử lại."); }
    finally { setChecking(false); }
  }
  const blocked = Boolean(!form.isSharedCode && (checking || csv && (!validation || csv.invalid.length || validation.duplicatesInFile.length || validation.alreadyStored.length)));
  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = adminVoucherInputSchema.safeParse(form);
    if (!result.success) { setFieldErrors(voucherFormErrors(result.error.issues)); return; }
    if (blocked || (!id && form.isSharedCode && !confirmed)) return;
    setBusy(true); setFailure(""); setFieldErrors({});
    const importCodes = !form.isSharedCode && csv?.codes.length ? csv.codes : null;
    let stage: Step = "update";
    try {
      const targetId = id ?? createdId;
      if (targetId) {
        if (id && !done.includes("update")) { await updateAdminVoucher(targetId, result.data); setDone((old) => [...old, "update"]); }
        stage = "price";
        if (id && !done.includes("price") && detail.data && (detail.data.voucher.basePoints !== form.basePoints || detail.data.voucher.promoPoints !== form.promoPoints)) { await changeAdminVoucherPrice(targetId, { basePoints: form.basePoints, promoPoints: form.promoPoints }); setDone((old) => [...old, "price"]); }
        stage = "codes";
        if (importCodes && !done.includes("codes")) { const imported = await importAdminVoucherCodes(targetId, { codes: importCodes, mode: "COMMIT" }); if (!imported.committed) { setValidation(imported); throw new Error("Import rejected"); } setDone((old) => [...old, "codes"]); }
        router.push(`/admin/vouchers/${targetId}`);
      } else {
        const created = await createAdminVoucher(result.data);
        setCreatedId(created.voucher.id);
        if (importCodes) {
          try {
            const checked = await importAdminVoucherCodes(created.voucher.id, { codes: importCodes, mode: "VALIDATE" }); setValidation(checked);
            if (checked.duplicatesInFile.length || checked.alreadyStored.length) throw new Error("Import rejected");
            const imported = await importAdminVoucherCodes(created.voucher.id, { codes: importCodes, mode: "COMMIT" });
            if (!imported.committed) { setValidation(imported); throw new Error("Import rejected"); }
          } catch { setFailure("Voucher đã tạo, chưa nạp được mã. Tải lại file để thử lại."); return; }
        }
        router.push(`/admin/vouchers/${created.voucher.id}`);
      }
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "VALIDATION_ERROR" && Array.isArray(cause.details)) {
        setFieldErrors(voucherFormErrors((cause.details as { path: string }[]).map((issue) => ({ path: [issue.path], message: "" }))));
      }
      const saved = done.concat(stage === "price" && id ? ["update"] : []).filter((step, index, all) => all.indexOf(step) === index);
      setFailure(createdId ? "Voucher đã tạo, chưa nạp được mã. Tải lại file để thử lại." : id && saved.length
        ? `Đã lưu ${saved.map((step) => STEP_LABELS[step]).join(", ")}; chưa lưu ${STEP_LABELS[stage]}. Bấm Lưu để thử lại phần còn lại.` : "Không lưu được voucher. Thử lại.");
    }
    finally { setBusy(false); }
  }
  const brand = brands.find((item) => item.id === form.brandId);
  const preview = { id: id ?? "preview", title: form.title || "Voucher mới", brand: brand ?? { id: "preview", name: "Thương hiệu" }, category: form.category, valueVnd: form.valueVnd, price: { points: form.promoPoints ?? form.basePoints, basePoints: form.basePoints, source: form.promoPoints ? "PROMO" as const : "BASE" as const, discountPercent: form.promoPoints ? Math.round((1 - form.promoPoints / form.basePoints) * 100) : 0, priceVersion: 1 }, status: "AVAILABLE" as const, stockTotal: 0, stockRemaining: 0, redeemEndsAt: form.redeemEndsAt, codeExpiresAt: form.codeExpiresAt, flash: null, affordable: true, imageUrl: form.imageUrl };
  const inputClass = "w-full rounded-field border border-line p-2";
  return <AdminPage title={id ? "Sửa voucher" : "Tạo voucher"} actions={<Link href={id ? `/admin/vouchers/${id}` : "/admin/vouchers"}>Quay lại</Link>}>
    {detail.error && id && <Alert tone="danger">{detail.error.status === 404 ? "Không tìm thấy voucher." : "Không tải được voucher."} <button onClick={detail.reload}>Thử lại</button></Alert>}
    {id && detail.loading ? <div className="h-96 animate-pulse rounded-card bg-surface-subtle" /> : <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]"><form className="space-y-5" onSubmit={(event) => void submit(event)}>
      {failure && <Alert tone="danger">{failure}{createdId && <Link className="ml-2 underline" href={`/admin/vouchers/${createdId}/edit`}>Mở trang sửa voucher</Link>}</Alert>}
      <section className="space-y-3 rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Thông tin chung</h2><label className="block">Tên voucher<input className={inputClass} value={form.title} onChange={(e) => set("title", e.target.value)} {...describe("title")} />{errorOf("title")}</label><label className="block">Thương hiệu<select className={inputClass} value={form.brandId} onChange={(e) => set("brandId", e.target.value)} {...describe("brandId")}><option value="">Chọn thương hiệu</option>{brands.map((b) => <option value={b.id} key={b.id}>{b.name}</option>)}</select>{errorOf("brandId")}</label><label className="block">Danh mục<select className={inputClass} value={form.category} onChange={(e) => set("category", e.target.value as Form["category"])}>{["COFFEE", "TEA", "CHICKEN_BURGER", "BAKERY_DESSERT"].map((c) => <option value={c} key={c}>{c}</option>)}</select></label><label className="block">URL ảnh (https://)<input type="url" disabled={Boolean(id)} className={inputClass} value={form.imageUrl ?? ""} onChange={(e) => set("imageUrl", e.target.value || null)} {...describe("imageUrl")} />{errorOf("imageUrl")}</label></section>
      <section className="space-y-3 rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Giá trị & giá điểm</h2>{([["valueVnd", "Giá trị (đ)"], ["basePoints", "Giá điểm"], ["promoPoints", "Giá khuyến mãi (điểm)"]] as const).map(([key, label]) => <label className="block" key={key}>{label}<input className={inputClass} type="number" min="1" value={form[key] ?? ""} onChange={(e) => set(key, e.target.value ? Number(e.target.value) : key === "promoPoints" ? null : 0)} {...describe(key)} />{errorOf(key)}</label>)}{deviationWarning(form.valueVnd, form.basePoints) && <Alert tone="info">{deviationWarning(form.valueVnd, form.basePoints)}</Alert>}{id && <p>Giá mới chỉ áp dụng cho lượt đổi sau khi lưu; các voucher đã đổi giữ giá cũ.</p>}</section>
      <section className="space-y-3 rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Thời gian & số lượng</h2>{([["redeemStartsAt", "Bắt đầu đổi"], ["redeemEndsAt", "Kết thúc đổi"], ["codeExpiresAt", "Mã hết hạn"]] as const).map(([key, label]) => <label className="block" key={key}>{label}<input type="datetime-local" className={inputClass} value={localDate(form[key])} onChange={(e) => { const iso = e.target.value ? vietnamIso(e.target.value) : null; if (iso) set(key, iso); }} {...describe(key)} />{errorOf(key)}</label>)}</section>
      <section className="space-y-3 rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Cách phát mã</h2><label className="block"><input type="radio" name="mode" checked={!form.isSharedCode} onChange={() => set("isSharedCode", false)} /> Mã riêng cho từng người (khuyên dùng)</label>{!form.isSharedCode && <><input type="file" accept=".csv,text/csv,text/plain" aria-label="Tệp mã CSV" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />{csv && <p>Nhận {validation?.received ?? csv.codes.length} · Hợp lệ {validation?.accepted ?? csv.codes.length} · Trùng trong file {validation?.duplicatesInFile.length ?? 0} · Đã tồn tại {validation?.alreadyStored.length ?? 0} · Dòng lỗi {csv.invalid.length}{!!validation?.duplicatesInFile.length && <span className="block">Trùng trong file: {codesSummary(validation.duplicatesInFile)}</span>}{!!validation?.alreadyStored.length && <span className="block">Đã tồn tại: {codesSummary(validation.alreadyStored)}</span>}</p>}{blocked && <Alert tone="danger">Có mã trùng hoặc không hợp lệ. Sửa CSV trước khi lưu.</Alert>}</>}<label className="block"><input type="radio" name="mode" checked={form.isSharedCode} onChange={() => { set("isSharedCode", true); setCsv(undefined); setValidation(undefined); }} /> Mã dùng chung</label>{!id && form.isSharedCode && <label><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Tôi xác nhận sẽ đặt số lượng phát trong phần tồn kho sau khi tạo.</label>}</section>
      <section className="space-y-3 rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Điều kiện & nơi áp dụng</h2>{id && <p role="status">Chưa thể xem hoặc sửa điều kiện, hướng dẫn và ảnh hiện có: API chi tiết chưa trả về các trường này.</p>}{([["terms", "Điều kiện"], ["howToUse", "Hướng dẫn sử dụng"]] as const).map(([key, label]) => <label key={key} className="block">{label}<textarea className={inputClass} disabled={Boolean(id)} value={form[key].join("\n")} onChange={(e) => set(key, e.target.value.split("\n").filter(Boolean))} {...describe(key)} />{errorOf(key)}</label>)}</section><Button type="submit" disabled={busy || blocked || !id && form.isSharedCode && !confirmed}>{busy ? "Đang lưu…" : "Lưu voucher"}</Button>
    </form><aside className="space-y-5"><div className="rounded-card border border-line bg-surface p-5"><h2 className="mb-3 font-bold">Xem trước</h2><div className="grid gap-3"><VoucherCard item={preview} layout="tile" /><VoucherCard item={preview} layout="row" /></div></div><div className="rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Kiểm tra trước khi lưu</h2><ul className="mt-3 space-y-2">{preCheckItems(form, csv ? { ...csv, duplicatesInFile: validation?.duplicatesInFile, alreadyStored: validation?.alreadyStored } : null, new Date().toISOString(), Boolean(id)).map((item, index) => <li key={index}>{item.tone === "ok" ? "✓" : "!"} {item.text}</li>)}</ul></div></aside></div>}
  </AdminPage>;
}
