"use client";

import type { VoucherDetailDto } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { confirmPriceLabel, failedView, flashEndsLine, redeemErrorView } from "@/lib/rewards/redeem-flow";
import { formatFullDate, formatPoints, formatVnd } from "@/lib/rewards/voucher-display";
import type { RedeemFlow } from "../hooks/use-redeem-flow";
import { VoucherThumb } from "./VoucherThumb";
import { RedeemErrorView } from "./RedeemErrorView";

export function RedeemSheet({ flow, voucher, viewer, nowMs }: { flow: RedeemFlow; voucher: VoucherDetailDto; viewer: { available: number }; nowMs: number }) {
  const { phase, quote } = flow;
  const busy = phase === "submitting";
  const polling = phase === "checking" && !flow.pollExhausted;
  const view = phase === "rejected" && flow.error ? redeemErrorView(flow.error, { priceSource: quote?.price.source ?? null, availableBefore: quote?.balance.available ?? viewer.available, quotePoints: quote?.price.points }) : phase === "failed" ? failedView(flow.failedKind) : null;
  return <Dialog open={phase !== "closed" && phase !== "success"} onClose={flow.close} dismissible={!busy && !polling} width={480} className="max-lg:mb-0 max-lg:w-full max-lg:rounded-b-none" labelledBy={view ? "redeem-error-title" : phase === "checking" ? "redeem-checking-title" : "redeem-confirm-title"}>
    <div className="mx-auto mt-3 h-1.25 w-10 rounded-full bg-line lg:hidden" aria-hidden />
    {view ? <RedeemErrorView view={view} voucher={voucher} onClose={flow.close} onRequote={flow.requote} /> : phase === "checking" ? <div className="px-6 pb-7 pt-5 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mascots/wait.svg" alt="" width={96} height={96} className="mx-auto" />
      <h2 id="redeem-checking-title" className="mt-4 text-title-sm font-bold">Đang kiểm tra kết quả</h2>
      <p className="mt-3 text-body-sm text-ink-muted">Mạng bị gián đoạn khi đang đổi. Rescom tự kiểm tra lại giao dịch. Bạn sẽ không bị trừ điểm 2 lần.</p>
      <div className="mt-5 space-y-4 rounded-[16px] bg-subtle p-4 text-left text-body-sm"><p><Icon name="check" size={16} /> Đã gửi yêu cầu đổi</p><p role="status">{flow.pollExhausted ? <Icon name="alert-circle" size={16} /> : <Spinner />} {flow.pollExhausted ? "Chưa nhận được kết quả sau 3 lần kiểm tra." : `Đang xác nhận với hệ thống (lần ${Math.max(1, flow.pollAttempt)}/3)`}</p><p><Icon name="ticket" size={16} /> Nếu thành công, voucher hiện trong Voucher của tôi</p></div>
      {flow.pollExhausted && <Button fullWidth size="base" className="mt-6" onClick={flow.recheck}>Kiểm tra lại</Button>}
      {!polling && <button type="button" className="mt-3 p-3 font-semibold text-primary" onClick={flow.close}>Đóng</button>}
    </div> : <div className="px-6 pb-7 pt-5">
      <div className="flex items-start justify-between"><div><h2 id="redeem-confirm-title" className="text-title-sm font-bold">Xác nhận đổi voucher</h2><p className="mt-1 text-body-sm text-ink-muted">Kiểm tra lại trước khi trừ điểm.</p></div><IconButton icon="x" label="Đóng" className="max-lg:hidden" disabled={busy} onClick={flow.close} /></div>
      <div aria-busy={phase === "quoting"}>
        {phase === "quoting" || !quote ? <><div className="thought-skeleton mt-6 h-16 rounded-[16px]" /><div className="thought-skeleton mt-5 h-[150px] rounded-[16px]" /><div className="thought-skeleton mt-5 h-20 rounded-[16px]" /><div className="thought-skeleton mt-5 h-12 rounded-[16px]" /></> : <>
          <div className="mt-6 flex gap-3"><VoucherThumb brand={voucher.brand} category={voucher.category} imageUrl={voucher.imageUrl} size="sm" /><div><p className="font-bold">{voucher.brand.name}</p><p className="text-body-sm text-ink-muted">{voucher.title} · {formatVnd(voucher.valueVnd)}</p><div className="mt-1 flex gap-1">{quote.price.source === "FLASH" && <span className="rounded-full bg-primary px-2 py-0.5 text-caption text-white"><Icon name="zap" size={12} /> Flash Sale</span>}{quote.price.source !== "BASE" && <span className="rounded-full bg-sale-bg px-2 py-0.5 text-caption text-sale-text">-{quote.price.discountPercent}%</span>}</div></div></div>
          <div className="mt-5 space-y-3 rounded-[16px] bg-subtle p-4 text-body-sm"><div className="flex justify-between"><span>{confirmPriceLabel(quote.price.source)}</span><strong className="text-tone-amber-fg">{formatPoints(quote.price.points)} điểm</strong></div><div className="flex justify-between"><span>Điểm khả dụng hiện có</span><strong>{formatPoints(quote.balance.available)} điểm</strong></div><div className="border-t border-line pt-3 flex justify-between"><span>Còn lại sau khi đổi</span><strong className="text-title-sm">{formatPoints(quote.balance.after)} điểm</strong></div></div>
          <div className="mt-5 space-y-2 text-caption"><p><Icon name="check" size={16} /> {voucher.isSharedCode ? "Mã dùng chung" : "Mã và QR"} có ngay trong Voucher của tôi.</p><p><Icon name="calendar" size={16} /> Dùng được đến hết {formatFullDate(voucher.codeExpiresAt)}.</p><p><Icon name="alert-circle" size={16} /> Đã đổi thì không trả lại điểm, trừ khi mã bị lỗi.</p></div>
          {quote.price.source === "FLASH" && quote.flashEndsAt && <p className="mt-4 rounded-[12px] bg-tone-amber-tint p-3 text-caption"><Icon name="clock" size={16} /> {flashEndsLine(quote.flashEndsAt, nowMs)}</p>}
          {busy && <div role="status" className="mt-4 rounded-[12px] bg-tone-blue-bg p-3 text-body-sm"><Spinner /> Đang giữ voucher và trừ điểm… Vui lòng không tắt ứng dụng.</div>}
          <div className="mt-6 flex flex-col items-center gap-2 lg:items-end"><Button size="base" className="w-full lg:w-auto" onClick={flow.confirm} autoFocus loading={busy} loadingLabel="Đang đổi…">Xác nhận đổi · {formatPoints(quote.price.points)} điểm</Button><button type="button" className="p-2 font-semibold text-primary disabled:opacity-50" onClick={flow.close} disabled={busy}>Để sau</button></div>
        </>}
      </div>
    </div>}
  </Dialog>;
}
