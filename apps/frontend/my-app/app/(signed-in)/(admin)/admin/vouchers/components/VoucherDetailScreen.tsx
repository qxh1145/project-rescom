"use client";

import Link from "next/link";
import { useState } from "react";
import { adminStockAdjustmentSchema, adminVoucherPriceChangeSchema } from "@rescom/schemas";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { adjustAdminVoucherStock, changeAdminVoucherPrice, importAdminVoucherCodes } from "@/lib/admin/rewards-vouchers-service";
import { deviationWarning, parseCodeCsv } from "@/lib/admin/rewards-vouchers-view";
import { formatShortDateTime } from "@/lib/format/date-time";
import { useAdminVoucher } from "../hooks/use-admin-voucher";

type Action = "price" | "stock" | "codes";
function codesSummary(codes: string[]) { return `${codes.slice(0, 20).join(", ")}${codes.length > 20 ? ` và ${codes.length - 20} mã khác` : ""}`; }
export function VoucherDetailScreen({ id }: { id: string }) {
  const query = useAdminVoucher(id);
  const voucher = query.data?.voucher;
  const [action, setAction] = useState<Action | null>(null);
  const [basePoints, setBasePoints] = useState(0);
  const [promoPoints, setPromoPoints] = useState("");
  const [total, setTotal] = useState(0);
  const [reason, setReason] = useState("");
  const [csv, setCsv] = useState<ReturnType<typeof parseCodeCsv>>();
  const [validation, setValidation] = useState<Awaited<ReturnType<typeof importAdminVoucherCodes>>>();
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file?: File) {
    setCsv(undefined); setValidation(undefined); setError("");
    if (!file) return;
    setChecking(true);
    try { const parsed = parseCodeCsv(await file.text()); setCsv(parsed); if (!parsed.invalid.length && parsed.codes.length) setValidation(await importAdminVoucherCodes(id, { codes: parsed.codes, mode: "VALIDATE" })); }
    catch { setError("Không kiểm tra được mã. Thử lại."); }
    finally { setChecking(false); }
  }
  async function save() {
    if (!action) return;
    setError("");
    const price = adminVoucherPriceChangeSchema.safeParse({ basePoints, promoPoints: promoPoints ? Number(promoPoints) : null });
    if (action === "price" && !price.success) { setError(Number.isFinite(basePoints) && basePoints > 0 ? "Giá khuyến mãi phải thấp hơn giá điểm thường." : "Nhập giá điểm là số nguyên lớn hơn 0."); return; }
    const stock = adminStockAdjustmentSchema.safeParse({ total, reason });
    if (action === "stock" && !stock.success) { setError(Number.isInteger(total) && total >= 0 ? "Nhập lý do từ 5 đến 500 ký tự." : "Tổng mã phải là số nguyên không âm."); return; }
    setBusy(true);
    try {
      if (action === "price" && price.success) await changeAdminVoucherPrice(id, price.data);
      if (action === "stock" && stock.success) await adjustAdminVoucherStock(id, stock.data);
      if (action === "codes" && csv) { const result = await importAdminVoucherCodes(id, { codes: csv.codes, mode: "COMMIT" }); if (!result.committed) { setValidation(result); setError("Có mã trùng. Chưa nạp mã nào."); return; } }
      setAction(null); query.reload();
    } catch (cause) { const issue = cause as { details?: { minimum?: number } }; setError(issue.details?.minimum !== undefined ? `Tồn kho tối thiểu ${issue.details.minimum} mã đã phát hoặc đang giữ cho Flash Sale.` : "Không cập nhật được voucher. Thử lại."); }
    finally { setBusy(false); }
  }
  return <AdminPage title={voucher?.title ?? "Chi tiết voucher"} actions={<Link href="/admin/vouchers" className="text-primary">Danh sách voucher</Link>}>
    {query.loading && <div className="h-96 animate-pulse rounded-card bg-surface-subtle" aria-label="Đang tải voucher" />}
    {query.error && <div className="flex gap-3"><Alert tone="danger">{query.error.status === 404 ? "Không tìm thấy voucher." : "Không tải được voucher."}</Alert><Button onClick={query.reload}>Thử lại</Button></div>}
    {voucher && query.data && <div className="space-y-5"><p>{voucher.brand.name} · {voucher.category} · <Link href={`/admin/vouchers/${id}/edit`} className="text-primary">Sửa thông tin</Link></p>
      <div className="grid grid-cols-3 gap-4">{[["Còn / tổng", `${voucher.stock.remaining}/${voucher.stock.total}`], ["Điểm đã tiêu (50 lượt gần nhất)", String(query.data.redemptions.reduce((sum, item) => sum + (item.kind === "SUCCEEDED" ? item.points : item.kind === "REFUNDED" ? -item.points : 0), 0))], ["Báo mã lỗi", "—"]].map(([label, value]) => <div key={label} className="rounded-card border border-line bg-surface p-5"><p>{label}</p><strong className="text-title-sm">{value}</strong></div>)}</div>
      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]"><section className="rounded-card border border-line bg-surface p-5"><h2 className="mb-4 font-bold">Lịch sử đổi</h2><table className="w-full text-left"><thead><tr>{["Thời gian", "Người dùng", "Giá áp dụng", "Mã đã phát"].map((heading) => <th scope="col" className="p-2" key={heading}>{heading}</th>)}</tr></thead><tbody>{query.data.redemptions.map((item) => <tr key={item.reference} className="border-t border-line"><td className="p-2">{formatShortDateTime(item.createdAt)}</td><td className="p-2">{item.userLabel}</td><td className="p-2">{item.points} điểm</td><td className="p-2">—</td></tr>)}</tbody></table>{!query.data.redemptions.length && <p className="py-8 text-center">Chưa có lượt đổi nào</p>}<p className="mt-3">Giá tại thời điểm đổi được giữ nguyên khi thay đổi giá mới.</p></section>
      <aside className="space-y-5"><section className="space-y-3 rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Giá điểm</h2><p>{voucher.price.points.toLocaleString("vi-VN")} điểm</p>{voucher.promoPoints !== null && <p>Giá khuyến mãi: {voucher.promoPoints.toLocaleString("vi-VN")} điểm</p>}{voucher.price.source === "FLASH" && <p>Flash Sale đang áp dụng</p>}{query.data.priceHistory.map((item) => <p key={item.version}>v{item.version} · {item.basePoints} điểm · {formatShortDateTime(item.effectiveFrom)}</p>)}{voucher.state !== "ARCHIVED" && <Button onClick={() => { setBasePoints(voucher.basePoints); setPromoPoints(voucher.promoPoints?.toString() ?? ""); setAction("price"); }}>Điều chỉnh giá điểm</Button>}</section><section className="space-y-2 rounded-card border border-line bg-surface p-5"><h2 className="font-bold">Tồn kho</h2><p>Tổng mã đã nạp: {voucher.stock.total}</p><p>Đã phát: {voucher.stock.issued}</p><p>Đang giữ cho Flash Sale: {voucher.stock.flashReserved}</p><p>Còn bán giá thường: {voucher.stock.remaining}</p>{voucher.state !== "ARCHIVED" && <><Button variant="secondary" onClick={() => { setTotal(voucher.stock.total); setAction("stock"); }}>Điều chỉnh tồn kho</Button>{!voucher.isSharedCode && <Button variant="secondary" onClick={() => { setCsv(undefined); setValidation(undefined); setAction("codes"); }}>Nạp thêm mã</Button>}</>}</section></aside></div>
    </div>}
    <Dialog open={Boolean(action)} labelledBy="voucher-detail-action" onClose={() => !busy && setAction(null)} dismissible={!busy}><div className="space-y-4 p-6"><h2 id="voucher-detail-action" className="text-title-sm font-bold">{action === "price" ? "Điều chỉnh giá điểm" : action === "stock" ? "Điều chỉnh tồn kho" : "Nạp thêm mã"}</h2>{error && <Alert tone="danger">{error}</Alert>}
      {action === "price" && <><label className="block">Giá điểm mới<input type="number" min="1" className="w-full rounded-field border p-2" value={basePoints} onChange={(e) => setBasePoints(Number(e.target.value))} /></label><label className="block">Giá khuyến mãi<input type="number" min="1" className="w-full rounded-field border p-2" value={promoPoints} onChange={(e) => setPromoPoints(e.target.value)} /></label><p>Giá mới chỉ áp dụng cho lượt đổi sau khi lưu; các voucher đã đổi giữ giá cũ.</p>{voucher && deviationWarning(voucher.valueVnd, basePoints) && <Alert tone="info">{deviationWarning(voucher.valueVnd, basePoints)}</Alert>}</>}
      {action === "stock" && voucher && <><label className="block">Tổng mã<input type="number" min={voucher.stock.issued + voucher.stock.flashReserved} className="w-full rounded-field border p-2" value={total} onChange={(e) => setTotal(Number(e.target.value))} /></label><label className="block">Lý do<input className="w-full rounded-field border p-2" value={reason} onChange={(e) => setReason(e.target.value)} /></label><p>Chỉ thu hồi được mã chưa phát và không đang giữ cho Flash Sale (tối đa {voucher.stock.remaining}). Tồn kho không thể âm.</p></>}
      {action === "codes" && <><input type="file" accept=".csv,text/csv,text/plain" aria-label="Tệp mã CSV" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />{csv && <p>Nhận {validation?.received ?? csv.codes.length} · Hợp lệ {validation?.accepted ?? csv.codes.length} · Trùng trong file {validation?.duplicatesInFile.length ? codesSummary(validation.duplicatesInFile) : "0"} · Đã tồn tại {validation?.alreadyStored.length ? codesSummary(validation.alreadyStored) : "0"} · Dòng không hợp lệ {csv.invalid.length}</p>}</>}
      <div className="flex gap-3"><Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>Huỷ</Button><Button disabled={busy || checking || action === "codes" && (!validation || !csv?.codes.length || !!csv.invalid.length || !!validation.duplicatesInFile.length || !!validation.alreadyStored.length)} onClick={() => void save()}>{busy ? "Đang lưu…" : "Xác nhận"}</Button></div></div></Dialog>
  </AdminPage>;
}
