import assert from "node:assert/strict";
import { test } from "node:test";
import { flashSaleItemSchema } from "@rescom/schemas";
import { flashStatusView, flashFormErrors, previewFlashItem, flashRowView, endEarlyCopy, monitorItemView, monitorTotals } from "../lib/admin/rewards-flash-view.ts";
import { dailyChartSummary, dailyChartData, dailyChartFootnote, flashPerformanceView, statsKpiView, usageRateNote, rangeToQuery, brandRowsView } from "../lib/admin/rewards-stats-view.ts";

const now = "2026-10-13T06:00:00Z";
const voucher = { id: "00000000-0000-4000-8000-000000000001", title: "Highlands 50k", brand: { id: "highlands", name: "Highlands" }, category: "COFFEE", valueVnd: 50000, basePoints: 250, promoPoints: null };
const item = (patch = {}) => ({ id: "i1", voucherId: voucher.id, voucherTitle: voucher.title, brand: voucher.brand, valueVnd: 50000, flashPoints: 150, regularPoints: 250, perUserCap: 1, sold: 75, quota: 100, unsold: 25, perMinute: 1.9, etaAt: null, soldOutAt: null, state: "ACTIVE", ...patch });
const flash = (patch = {}) => ({ code: "FS-261013-A", title: "Flash trưa", createdBy: { name: "Admin Hùng" }, status: "ACTIVE", startsAt: "2026-10-13T05:00:00Z", endsAt: "2026-10-13T08:00:00Z", endedEarlyAt: null, endReason: null, remindCount: 312, succeededCount: 75, pointsSpent: 1200, participants: 30, failures: { SOLD_OUT: 14, INSUFFICIENT_POINTS: 7, OTHER: 0 }, afterTopUp: { count: 9, rate: 0.05, flagged: 1 }, items: [item()], ...patch });

test("status labels", () => {
  assert.deepEqual(["SCHEDULED", "UPCOMING", "ACTIVE", "SOLD_OUT", "ENDED"].map(s => flashStatusView(s).label), ["Hẹn lịch", "Sắp diễn ra", "Đang diễn ra", "Hết suất", "Đã kết thúc"]);
  assert.equal(flashRowView(flash()).soldLabel, "75/100");
});

test("row subtitle for all five states and the early-end reason", () => {
  assert.equal(flashRowView(flash({ status: "SCHEDULED" })).subtitle, "1 voucher · tạo bởi Admin Hùng");
  assert.equal(flashRowView(flash({ status: "UPCOMING" })).subtitle, "312 người đã bấm Nhắc tôi");
  assert.equal(flashRowView(flash()).subtitle, "1 voucher · đang diễn ra");
  const out = item({ sold: 100, unsold: 0, soldOutAt: "2026-10-13T05:38:00Z" });
  assert.equal(flashRowView(flash({ status: "SOLD_OUT", items: [out] })).subtitle, "Hết suất sau 38 phút");
  assert.equal(flashRowView(flash({ status: "ENDED", items: [out] })).subtitle, "Hết suất sau 38 phút");
  assert.equal(flashRowView(flash({ status: "ENDED", items: [item({ unsold: 28 })] })).subtitle, "Kết thúc đúng giờ, dư 28 suất");
  assert.equal(flashRowView(flash({ status: "ENDED", endedEarlyAt: "2026-10-13T06:30:00Z", endReason: "WRONG_PRICE" })).subtitle, "Kết thúc sớm · Sai giá");
  assert.doesNotMatch(flashRowView(flash({ status: "ENDED", endedEarlyAt: "2026-10-13T06:30:00Z", endReason: "PARTNER_REQUEST" })).subtitle, /PARTNER_REQUEST/);
});

test("row actions follow the status", () => {
  assert.deepEqual(flashRowView(flash()).actions, ["preview", "end"]);
  assert.deepEqual(flashRowView(flash({ status: "SCHEDULED" })).actions, ["preview", "edit"]);
  assert.deepEqual(flashRowView(flash({ status: "ENDED" })).actions, ["preview"]);
});

test("monitor: server ETA, 'còn dư' branch, sold-out footnote and totals", () => {
  const f = flash();
  assert.equal(monitorItemView(item({ etaAt: "2026-10-13T06:15:00Z" }), f).footnote, "Tốc độ 1,9 suất/phút · dự kiến hết lúc 13:15");
  assert.match(monitorItemView(item({ etaAt: "2026-10-13T09:00:00Z" }), f).footnote, /có thể còn dư 0–25 suất/);
  assert.match(monitorItemView(item({ etaAt: null }), f).footnote, /có thể còn dư 0–25 suất/);
  const out = monitorItemView(item({ sold: 100, unsold: 0, soldOutAt: "2026-10-13T05:41:00Z" }), f);
  assert.equal(out.footnote, "Hết suất lúc 12:41 · đã về giá thường 250");
  assert.equal(out.badge, "Hết suất");
  assert.equal(monitorItemView(item(), f).badge, null);
  assert.deepEqual([monitorItemView(item(), f).priceLabel, monitorItemView(item(), f).regularLabel], ["150 điểm", "250"]);
  const totals = monitorTotals(f).map(t => t.value);
  assert.equal(totals[3], "21 · hết suất 14, thiếu điểm 7");
  assert.equal(totals[4], "9 lượt · 5% · đã gắn cờ 1");
  assert.equal(totals[0], "75/100 suất");
  assert.equal(totals.length, 5);
});

test("end-early dialog copy is exact and omits sold-out items", () => {
  const two = flash({ succeededCount: 173, items: [item({ unsold: 25 }), item({ brand: { id: "lotteria", name: "Lotteria" }, regularPoints: 125, unsold: 32 }), item({ brand: { id: "gc", name: "Gong Cha" }, regularPoints: 100, unsold: 0, sold: 50, quota: 50 })] });
  assert.deepEqual(endEarlyCopy(two), [
    "Giá 2 voucher đang chạy về giá thường ngay (Highlands 250, Lotteria 125).",
    "57 suất chưa đổi (25 + 32) trả về kho giá thường.",
    "Người đang ở bước xác nhận sẽ thấy “Giá vừa thay đổi”; không ai bị trừ sai giá.",
    "173 giao dịch đã thành công giữ nguyên giá Flash.",
  ]);
});

test("field issues and server conflicts map to Vietnamese row messages", () => {
  const errors = flashFormErrors([{ path: ["endsAt"], message: "Flash Sale maximum six hours" }], [{ path: "items.0.quota", code: "FLASH_QUOTA_EXCEEDS_STOCK", details: { available: 14 } }]);
  assert.equal(errors.endsAt, "Flash Sale dài tối đa 6 giờ.");
  assert.equal(errors["items.0.quota"], "Tối đa 14 suất chưa giữ.");
  const rows = flashFormErrors([], [
    { path: "items.0.flashPoints", code: "FLASH_PRICE_NOT_BELOW_REGULAR", details: { regular: 250 } },
    { path: "items.0.voucherId", code: "FLASH_OVERLAP", details: { code: "FS-261013-A" } },
    { path: "items.0.voucherId", code: "VOUCHER_NOT_FLASHABLE" },
    { path: "items.1.quota", code: "FLASH_QUOTA_BELOW_SOLD", details: { sold: 40 } },
    { path: "startsAt", code: "FLASH_STARTS_IN_PAST" },
  ]);
  assert.equal(rows["items.0.flashPoints"], "Giá Flash phải thấp hơn giá hiện tại (250 điểm).");
  // Two conflicts on the same field keep both messages.
  assert.equal(rows["items.0.voucherId"], "Trùng giờ với FS-261013-A. Voucher này không thể đưa vào Flash Sale.");
  assert.equal(rows["items.1.quota"], "Không thể thấp hơn 40 suất đã đổi.");
  assert.equal(rows.startsAt, "Giờ bắt đầu phải ở tương lai.");
});

test("Zod issues: empty date, duplicate vouchers, empty list and item fields speak Vietnamese", () => {
  const e = flashFormErrors([
    { path: ["startsAt"], message: "Invalid datetime", code: "invalid_string" },
    { path: ["endsAt"], message: "Invalid datetime" },
    { path: ["endsAt"], message: "End must follow start" },
    { path: ["items"], message: "Invalid input", code: "custom" },
    { path: ["items", 0, "flashPoints"], message: "Number must be greater than 0" },
    { path: ["items", 0, "quota"], message: "Expected number, received nan" },
    { path: ["title"], message: "String must contain at least 1 character(s)" },
  ]);
  assert.equal(e.startsAt, "Chọn giờ bắt đầu hợp lệ.");
  assert.equal(e.endsAt, "Chọn giờ kết thúc hợp lệ. Giờ kết thúc phải sau giờ bắt đầu.");
  assert.equal(e.items, "Mỗi voucher chỉ được chọn một lần.");
  assert.equal(e["items.0.flashPoints"], "Nhập giá Flash là số nguyên dương.");
  assert.equal(e["items.0.quota"], "Nhập số suất là số nguyên dương.");
  assert.equal(e.title, "Nhập tên chương trình (tối đa 60 ký tự).");
  assert.equal(flashFormErrors([{ path: ["items"], message: "Array must contain at least 1 element(s)", code: "too_small" }]).items, "Chọn ít nhất một voucher.");
});

test("preview rejects invalid rows and returns an item the user card schema accepts", () => {
  assert.equal(previewFlashItem({ voucherId: voucher.id, flashPoints: 250, quota: 1 }, voucher, "ACTIVE"), null);
  assert.equal(previewFlashItem({ voucherId: voucher.id, flashPoints: 150, quota: 0 }, voucher, "ACTIVE"), null);
  assert.equal(previewFlashItem({ voucherId: voucher.id, flashPoints: 150, quota: 5 }, undefined, "ACTIVE"), null);
  const preview = previewFlashItem({ voucherId: voucher.id, flashPoints: 150, quota: 10 }, voucher, "ACTIVE");
  assert.equal(preview.discountPercent, 40);
  assert.equal(preview.state, "ACTIVE");
  const parsed = flashSaleItemSchema.safeParse(preview);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

const stats = (patch = {}) => ({
  range: { from: "2026-09-14", to: "2026-10-13" }, updatedAt: now,
  kpis: { activeVouchers: { active: 5, total: 7, soldOut: 1, expired: 1 }, redemptions: { count: 1397, avgPerRegularDay: 36 }, pointsSpent: { points: 233170, vndEquivalent: 46634000 }, redemptionRate: { redeemed: 1397, offered: 1870, rate: 0.747 }, topVoucher: { voucherId: voucher.id, label: "Highlands 50k", count: 412, share: 0.295 }, selfReportedUsageRate: 0.42 },
  daily: [{ date: "2026-09-27", count: 20, flashSaleCodes: [] }, { date: "2026-09-28", count: 128, flashSaleCodes: ["FS-260928-A"] }, { date: "2026-10-13", count: 90, flashSaleCodes: ["FS-261013-A"] }],
  byBrand: [], flashSales: [
    { flashSaleId: "a", code: "FS-260928-A", startsAt: "2026-09-28T05:00:00Z", itemsLabel: "Highlands 50k", sold: 100, quota: 100, status: "ENDED", pointsSpent: 15000, soldOutAfterMinutes: 38 },
    { flashSaleId: "b", code: "FS-261013-A", startsAt: "2026-10-13T05:00:00Z", itemsLabel: "HL", sold: 173, quota: 230, status: "ACTIVE", pointsSpent: 19070, soldOutAfterMinutes: null },
    { flashSaleId: "c", code: "FS-261013-B", startsAt: "2026-10-13T12:00:00Z", itemsLabel: "HL", sold: 0, quota: 50, status: "UPCOMING", pointsSpent: 0, soldOutAfterMinutes: null }],
  ...patch });

test("stats KPIs keep the range and the self-reported label", () => {
  const kpis = statsKpiView(stats());
  assert.equal(kpis[1].detail, "3 ngày · trung bình 36 lượt/ngày thường");
  assert.equal(kpis.length, 5);
  assert.match(usageRateNote(stats()), /tự báo/);
});

test("chart: summary from data, fallback, tooltip notes and footnote when a program is active", () => {
  assert.equal(dailyChartSummary(stats({ daily: [], flashSales: [] })), "Chưa có ngày Flash Sale trong kỳ");
  assert.match(dailyChartSummary(stats()), /^Ngày có Flash Sale có lượt đổi gấp 2,5–3,6 lần ngày thường$/);
  const data = dailyChartData(stats());
  assert.deepEqual(data[1].flashNotes, ["FS-260928-A: 100 suất Flash, hết sau 38 phút"]);
  assert.deepEqual(data[2].flashNotes, ["FS-261013-A: 173 suất Flash"]);
  assert.equal(data[1].label, "28/09");
  assert.match(dailyChartFootnote(stats()), /Flash Sale vẫn đang chạy/);
  // A program that started yesterday and runs past midnight still counts as running.
  assert.match(dailyChartFootnote(stats({ flashSales: [{ ...stats().flashSales[1], startsAt: "2026-10-12T16:00:00Z" }] })), /vẫn đang chạy/);
  assert.doesNotMatch(dailyChartFootnote(stats({ flashSales: [stats().flashSales[0]] })), /vẫn đang chạy/);
});

test("flash performance labels every status honestly", () => {
  const [sold, active, upcoming] = flashPerformanceView(stats()).map(f => f.detail);
  assert.equal(sold, "100/100 suất · hết suất sau 38 phút · 15.000 điểm");
  assert.equal(active, "173/230 suất · đang diễn ra · 19.070 điểm");
  assert.equal(upcoming, "0/50 suất · sắp diễn ra · 0 điểm");
  assert.equal(flashPerformanceView(stats({ flashSales: [{ ...stats().flashSales[0], soldOutAfterMinutes: null }] }))[0].detail.includes("đã kết thúc"), true);
});

test("brand rows sort by redemptions and Vietnam calendar ranges", () => {
  assert.deepEqual(brandRowsView(stats()), []);
  assert.deepEqual(rangeToQuery("month", "2026-10-31T18:00:00Z"), { from: "2026-11-01", to: "2026-11-01" });
  assert.deepEqual(rangeToQuery("7d", "2026-10-13T06:00:00Z"), { from: "2026-10-07", to: "2026-10-13" });
});
