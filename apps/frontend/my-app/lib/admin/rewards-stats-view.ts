import type { RewardsStatsDto } from "@rescom/schemas";
import { formatDayMonth, formatTime, vietnamDateKey } from "../format/date-time.ts";
import { formatPoints } from "../rewards/voucher-display.ts";

type Stats = RewardsStatsDto;
const percent = (ratio: number) => `${(ratio * 100).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%`;

export function statsKpiView(stats: Stats) {
  const { activeVouchers: vouchers, redemptions, pointsSpent, redemptionRate, topVoucher } = stats.kpis;
  return [
    { label: "Voucher đang phân phối", value: `${vouchers.active}/${vouchers.total}`, detail: `${vouchers.soldOut} hết hàng · ${vouchers.expired} hết hạn đổi` },
    { label: "Lượt đổi voucher", value: formatPoints(redemptions.count), detail: `${stats.daily.length} ngày · trung bình ${formatPoints(Math.round(redemptions.avgPerRegularDay))} lượt/ngày thường` },
    { label: "Điểm đã tiêu", value: formatPoints(pointsSpent.points), detail: `≈ ${(pointsSpent.vndEquivalent / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} triệu đ theo tỷ giá 200đ` },
    { label: "Tỷ lệ đổi", value: percent(redemptionRate.rate), detail: `${formatPoints(redemptionRate.redeemed)} lượt / ${formatPoints(redemptionRate.offered)} suất mở bán` },
    { label: "Phổ biến nhất", value: topVoucher?.label ?? "—", detail: topVoucher ? `${formatPoints(topVoucher.count)} lượt · ${percent(topVoucher.share)} tổng lượt đổi trong kỳ` : "Chưa có lượt đổi" },
  ];
}

export function usageRateNote(stats: Stats) { return `Tỷ lệ dùng (người dùng tự báo): ${percent(stats.kpis.selfReportedUsageRate)}`; }

export function dailyChartData(stats: Stats) {
  return stats.daily.map(day => ({ date: day.date, label: formatDayMonth(`${day.date}T12:00:00+07:00`), count: day.count, isFlash: day.flashSaleCodes.length > 0, flashCodes: day.flashSaleCodes,
    flashNotes: day.flashSaleCodes.map(code => { const flash = stats.flashSales.find(f => f.code === code);
      return flash ? `${code}: ${formatPoints(flash.sold)} suất Flash${flash.soldOutAfterMinutes !== null ? `, hết sau ${formatPoints(flash.soldOutAfterMinutes)} phút` : ""}` : code; }) }));
}

export function dailyChartSummary(stats: Stats) {
  const flashDays = stats.daily.filter(day => day.flashSaleCodes.length);
  if (!flashDays.length || !stats.kpis.redemptions.avgPerRegularDay) return "Chưa có ngày Flash Sale trong kỳ";
  const rates = flashDays.map(day => day.count / stats.kpis.redemptions.avgPerRegularDay);
  return `Ngày có Flash Sale có lượt đổi gấp ${Math.min(...rates).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}–${Math.max(...rates).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} lần ngày thường`;
}

export function dailyChartFootnote(stats: Stats) {
  const active = stats.flashSales.some(flash => flash.status === "ACTIVE"); // a program that crossed midnight still runs today
  return `Trung bình ngày thường ${formatPoints(stats.kpis.redemptions.avgPerRegularDay)} lượt.${active ? ` ${formatDayMonth(stats.updatedAt)} tính đến ${formatTime(stats.updatedAt)}, Flash Sale vẫn đang chạy.` : ""}`;
}

export function brandRowsView(stats: Stats) {
  const max = Math.max(1, ...stats.byBrand.map(row => row.redemptions));
  return [...stats.byBrand].sort((a, b) => b.redemptions - a.redemptions).map(row => ({ ...row, barRatio: row.redemptions / max, redemptionsLabel: formatPoints(row.redemptions), pointsLabel: `${formatPoints(row.pointsSpent)} điểm`, soldLabel: percent(row.soldRatio) }));
}

const FLASH_STATE_LABEL = { SCHEDULED: "hẹn lịch", UPCOMING: "sắp diễn ra", ACTIVE: "đang diễn ra", SOLD_OUT: "hết suất", ENDED: "đã kết thúc" } as const;
export function flashPerformanceView(stats: Stats) {
  return stats.flashSales.map(flash => {
    const state = flash.soldOutAfterMinutes !== null && (flash.status === "SOLD_OUT" || flash.status === "ENDED") ? `hết suất sau ${formatPoints(flash.soldOutAfterMinutes)} phút` : FLASH_STATE_LABEL[flash.status];
    return { ...flash, title: `${flash.code} · ${formatDayMonth(flash.startsAt)}`, percentLabel: `${percent(flash.quota ? flash.sold / flash.quota : 0)} bán`, detail: `${formatPoints(flash.sold)}/${formatPoints(flash.quota)} suất · ${state} · ${formatPoints(flash.pointsSpent)} điểm` };
  });
}

export const STATS_RANGES = [
  { key: "7d", label: "7 ngày qua" }, { key: "30d", label: "30 ngày qua" },
  { key: "90d", label: "90 ngày qua" }, { key: "month", label: "Tháng này" },
] as const;
export type StatsRange = typeof STATS_RANGES[number]["key"];
export function rangeToQuery(key: string, now: string | Date) {
  const to = vietnamDateKey(now);
  const day = new Date(`${to}T00:00:00Z`);
  if (key === "month") day.setUTCDate(1);
  else day.setUTCDate(day.getUTCDate() - (({ "7d": 6, "30d": 29, "90d": 89 } as Record<string, number>)[key] ?? 29));
  return { from: day.toISOString().slice(0, 10), to };
}
