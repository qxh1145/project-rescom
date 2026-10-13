"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { STATS_RANGES, statsKpiView, dailyChartData, dailyChartSummary, dailyChartFootnote, brandRowsView, flashPerformanceView, usageRateNote } from "@/lib/admin/rewards-stats-view";
import { CHART_AXIS_COLOR, CHART_GRID_COLOR } from "@/lib/forms/results-analytics";
import { vietnamDateTimeParts } from "@/lib/format/date-time";
import { useRewardsStats } from "../hooks/use-rewards-stats";

type DayPoint = ReturnType<typeof dailyChartData>[number];
const FLASH_COLOR = "var(--color-sale-text)", REGULAR_COLOR = "var(--color-line-strong)";
function DayTooltip({ active, payload }: Pick<TooltipContentProps<number, string>, "active" | "payload">) {
  const day = active ? (payload?.[0]?.payload as DayPoint | undefined) : undefined;
  if (!day) return null;
  return <div className="max-w-[260px] rounded-field border border-line bg-surface px-3 py-2 text-caption shadow-[0_4px_16px_rgba(30,36,70,0.12)]"><p className="font-bold text-ink">{day.label} · {day.count.toLocaleString("vi-VN")} lượt</p>{day.flashNotes.map((note) => <p key={note} className="text-ink-strong">{note}</p>)}</div>;
}

export function VoucherStatsScreen() {
  const [range, setRange] = useState("30d");
  const query = useRewardsStats(range);
  const stats = query.data;
  const updated = vietnamDateTimeParts(stats?.updatedAt);
  const daily = stats ? dailyChartData(stats) : [];
  const peak = Math.max(0, ...daily.map((day) => day.count));
  return <AdminPage title="Thống kê voucher" meta={updated ? `Cập nhật ${updated.day}/${updated.month}/${updated.year} ${updated.hour}:${updated.minute}` : undefined} actions={<Select id="stats-range" aria-label="Khoảng thời gian" options={STATS_RANGES.map(({ key, label }) => ({ value: key, label }))} value={range} onChange={(event) => setRange(event.target.value)} />}>
    <div className="space-y-6">
      {query.loading && !stats && <div aria-label="Đang tải thống kê" className="h-96 animate-pulse rounded-card bg-surface-subtle" />}
      {query.error && <div className="flex items-center gap-3"><Alert tone="danger">Không tải được thống kê voucher.</Alert><Button onClick={query.reload}>Thử lại</Button></div>}
      {stats && <>
        <div className="grid gap-4 lg:grid-cols-5">{statsKpiView(stats).map((kpi) => <section key={kpi.label} className="rounded-card border border-line bg-surface p-5"><h2 className="text-ink-muted">{kpi.label}</h2><strong className="my-2 block text-title-sm">{kpi.value}</strong><p className="text-caption text-ink-muted">{kpi.detail}</p></section>)}</div>
        <section className="rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Lượt đổi theo ngày</h2><p>{dailyChartSummary(stats)}</p><p className="text-ink-muted">{dailyChartFootnote(stats)}</p><div className="mt-3 flex gap-5 text-body-sm"><span className="flex items-center gap-2"><i aria-hidden="true" className="size-3 rounded-sm" style={{ background: FLASH_COLOR }} />Ngày có Flash Sale</span><span className="flex items-center gap-2"><i aria-hidden="true" className="size-3 rounded-sm" style={{ background: REGULAR_COLOR }} />Ngày thường</span></div>{!stats.kpis.redemptions.count && <p>Chưa có lượt đổi trong kỳ</p>}<div className="mt-5 h-72" role="img" aria-label={dailyChartSummary(stats)}><ResponsiveContainer width="100%" height="100%"><BarChart data={daily}><CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} /><XAxis dataKey="label" tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }} tickLine={false} axisLine={{ stroke: CHART_GRID_COLOR }} interval="preserveStartEnd" minTickGap={8} /><YAxis allowDecimals={false} tick={{ fill: CHART_AXIS_COLOR, fontSize: 12 }} tickLine={false} axisLine={false} /><Tooltip content={DayTooltip} cursor={{ fill: CHART_GRID_COLOR }} isAnimationActive={false} /><Bar dataKey="count" radius={[4, 4, 0, 0]} label={{ position: "top", formatter: (value) => Number(value) === peak && peak > 0 ? String(value) : "" }}>{daily.map((day) => <Cell key={day.date} fill={day.isFlash ? FLASH_COLOR : REGULAR_COLOR} />)}</Bar></BarChart></ResponsiveContainer></div><table className="sr-only"><caption>Lượt đổi từng ngày, gồm đánh dấu ngày Flash Sale</caption><thead><tr><th scope="col">Ngày</th><th scope="col">Lượt đổi</th><th scope="col">Flash Sale</th></tr></thead><tbody>{daily.map((day) => <tr key={day.date}><td>{day.label}</td><td>{day.count}</td><td>{day.flashNotes.join("; ") || "Không"}</td></tr>)}</tbody></table></section>
        <div className="grid gap-6 xl:grid-cols-2"><section className="rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Hiệu quả Flash Sale</h2><div className="space-y-4">{flashPerformanceView(stats).map((flash) => <div key={flash.flashSaleId} className="border-b border-line py-3"><strong>{flash.title}</strong><p>{flash.itemsLabel}</p><p>{flash.percentLabel} · {flash.detail}</p></div>)}</div></section><section className="overflow-x-auto rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Theo thương hiệu</h2><table className="w-full text-left text-body-sm"><thead><tr>{["Thương hiệu", "Lượt đổi", "Điểm đã tiêu", "Đã bán / mở bán"].map((label) => <th scope="col" key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{brandRowsView(stats).map((row) => <tr key={row.brand.id} className="border-t border-line"><td className="p-2">{row.brand.name}<div aria-hidden="true" className="h-1 bg-primary" style={{ width: `${row.barRatio * 100}%` }} /></td><td className="p-2">{row.redemptionsLabel}</td><td className="p-2">{row.pointsLabel}</td><td className="p-2">{row.soldLabel}</td></tr>)}</tbody></table></section></div>
        <section className="rounded-card border border-line bg-surface p-6"><h2 className="text-title-sm font-bold">Cách tính</h2><ul className="mt-3 list-disc space-y-2 pl-5"><li>Lượt đổi chỉ tính giao dịch thành công; giao dịch hoàn điểm không tính.</li><li>Ngày được tính theo giờ Việt Nam.</li><li>Tỷ lệ đổi = lượt đổi / suất mở bán trong kỳ.</li><li>Ngày thường không gồm ngày có Flash Sale.</li><li>{usageRateNote(stats)}; dựa trên phản hồi người dùng, không phải dữ liệu xác minh.</li></ul></section>
      </>}
    </div>
  </AdminPage>;
}
