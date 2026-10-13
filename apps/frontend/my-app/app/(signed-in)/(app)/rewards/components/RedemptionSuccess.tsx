"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import type { RedemptionQuoteDto, RedemptionResultDto } from "@rescom/schemas";
import { ButtonLink } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { useReducedMotion } from "@/components/analytics/use-reduced-motion";
import { copyTextToClipboard, CLIPBOARD_COPY_FAILED_MESSAGE } from "@/lib/clipboard";
import { formatFullDate, formatPoints } from "@/lib/rewards/voucher-display";
import { tweenValue } from "@/lib/rewards/redeem-flow";
import { VoucherTicketCard } from "./VoucherTicketCard";

function useTweenedNumber(from: number, to: number, duration = 400) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    const start = performance.now();
    const tick = (time: number) => { const elapsed = time - start; setValue(tweenValue(from, to, elapsed, duration)); if (elapsed < duration) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, duration, reduced]);
  return reduced ? to : value;
}

export function RedemptionSuccess({ quote, result }: { quote: RedemptionQuoteDto; result: RedemptionResultDto }) {
  const reduced = useReducedMotion();
  const balance = useTweenedNumber(quote.balance.available, result.balanceAfter);
  const heading = useRef<HTMLHeadingElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  useEffect(() => { heading.current?.focus(); }, []);
  const ticket = result.ticket;
  const ticketHref = `/rewards/my-vouchers/${encodeURIComponent(ticket.id)}`;
  return <main className="mx-auto flex min-h-[calc(100dvh-140px)] max-w-[480px] flex-col px-5 pb-8 pt-8">
    <div className="text-center"><div className="relative mx-auto w-40">{!reduced && Array.from({ length: 9 }, (_, i) => <span key={i} aria-hidden className={`redeem-confetti absolute size-2 rounded-full ${i % 4 === 0 ? "bg-primary" : i % 4 === 1 ? "bg-tone-amber-fg" : i % 4 === 2 ? "bg-tone-teal-fg" : "bg-sale-text"}`} style={{ left: `${10 + (i * 29) % 80}%`, top: `${(i * 13) % 65}%`, animationDelay: `${i * 35}ms` }} />)}<img src="/brand/mascots/cheer.svg" alt="" width={160} height={160} className="redeem-pop" /></div><h1 ref={heading} tabIndex={-1} className="mt-4 text-title font-extrabold outline-none">Đổi thành công!</h1><p className="mt-2 text-body-sm text-ink-muted">Voucher đã nằm trong Voucher của tôi. Dùng trước {formatFullDate(ticket.expiresAt)} nhé.</p></div>
    <div className="mt-7"><VoucherTicketCard ticket={ticket} nowMs={Date.parse(result.createdAt)} href={ticketHref} /></div>
    <div className="mt-5 rounded-[16px] bg-subtle p-4 text-body-sm space-y-3"><div className="flex justify-between"><span>Đã trừ</span><strong>{formatPoints(result.pointsSpent)} điểm</strong></div><div className="flex justify-between"><span>Điểm khả dụng còn lại</span><strong><span aria-hidden>{formatPoints(balance)} điểm</span><span className="sr-only">{formatPoints(result.balanceAfter)} điểm</span></strong></div><div className="flex items-center justify-between border-t border-line pt-3"><span>Mã giao dịch</span><strong>{result.reference}</strong><IconButton icon="copy" label="Sao chép mã giao dịch" onClick={() => { void copyTextToClipboard(result.reference).then(ok => setCopyMessage(ok ? "Đã sao chép" : CLIPBOARD_COPY_FAILED_MESSAGE)); }} /></div><span className="sr-only" aria-live="polite">{copyMessage === "Đã sao chép" ? copyMessage : ""}</span>{copyMessage && copyMessage !== "Đã sao chép" && <p role="alert">{copyMessage}</p>}</div>
    <div className="mt-auto pt-8 max-lg:sticky max-lg:bottom-[calc(62px+env(safe-area-inset-bottom))]"><ButtonLink href={ticketHref} variant="primary" size="base" className="w-full">Dùng voucher ngay</ButtonLink><ButtonLink href="/rewards" variant="outline" size="base" className="mt-3 w-full">Tiếp tục đổi quà</ButtonLink></div>
  </main>;
}
