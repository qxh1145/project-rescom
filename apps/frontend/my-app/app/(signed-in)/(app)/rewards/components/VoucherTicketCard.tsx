import Link from "next/link";
import type { VoucherTicketDto } from "@rescom/schemas";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import { ticketCtaLabel, ticketMetaLine, ticketTagView } from "@/lib/rewards/my-vouchers";
import { brandTintClass, formatVnd } from "@/lib/rewards/voucher-display";
import { VoucherThumb } from "./VoucherThumb";

const NOTCH = "absolute left-[78px] size-2.5 rounded-full border border-line bg-background";

/** Figma "VoucherTicket": stub on the brand tint, dashed tear line with two notches, status Tag, CTA. */
export function VoucherTicketCard({ ticket, nowMs, href }: { ticket: VoucherTicketDto; nowMs: number; href: string }) {
  const tag = ticketTagView(ticket, nowMs);
  const dim = ticket.status === "USED" || ticket.status === "EXPIRED";
  return (
    <Link href={href} className="group relative flex min-h-[99px] overflow-hidden rounded-[20px] border border-line bg-surface shadow-xs transition-colors hover:border-line-strong">
      <div className={`flex w-21 shrink-0 items-center justify-center border-r border-dashed border-line ${brandTintClass(ticket.brand.id, ticket.category)} ${dim ? "opacity-60 grayscale" : ""}`}>
        <VoucherThumb brand={ticket.brand} category={ticket.category} size="sm" />
      </div>
      <span aria-hidden className={`${NOTCH} -top-[5px]`} />
      <span aria-hidden className={`${NOTCH} -bottom-[5px]`} />
      <div className="min-w-0 flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-caption text-ink-muted">{ticket.brand.name}</p>
          <Tag tone={tag.tone}>{tag.label}</Tag>
        </div>
        <p className="mt-0.5 text-body-lg font-extrabold text-ink">Voucher {formatVnd(ticket.valueVnd)}</p>
        <p className="mt-0.5 text-caption text-ink-muted">{ticketMetaLine(ticket, nowMs)}</p>
        <p className="mt-2 flex items-center gap-1 text-label font-bold text-primary">{ticketCtaLabel(ticket.status)}<Icon name="chevron-right" size={16} /></p>
      </div>
    </Link>
  );
}
