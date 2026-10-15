"use client";

import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { MARKETPLACE_ACTIVATION_PATH } from "@/lib/onboarding";
import type { RedeemView, RedeemTarget } from "@/lib/rewards/redeem-flow";
import type { VoucherDetailDto } from "@rescom/schemas";

export function RedeemErrorView({ view, voucher, onClose, onRequote }: { view: RedeemView; voucher: VoucherDetailDto; onClose: () => void; onRequote: () => void }) {
  const href: Partial<Record<RedeemTarget, string>> = {
    rewards: "/rewards", rewardsCategory: `/rewards?category=${voucher.category}`,
    marketplace: "/marketplace", topUp: "/wallet/top-up", wallet: "/wallet", activation: MARKETPLACE_ACTIVATION_PATH,
  };
  const action = ({ label, target }: RedeemView["primary"], primary: boolean) => {
    const className = primary ? "flex h-12 items-center justify-center rounded-control bg-primary text-white font-bold" : "w-full text-center text-primary font-semibold py-3";
    if (href[target]) return <Link href={href[target]} onClick={onClose} className={className} autoFocus={primary}>{label}</Link>;
    return primary ? <Button size="base" fullWidth autoFocus onClick={target === "requote" ? onRequote : onClose}>{label}</Button> : <button type="button" className={className} onClick={target === "requote" ? onRequote : onClose}>{label}</button>;
  };
  return <div className="px-6 pb-7 pt-5 text-center">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/brand/mascots/${view.mascot}`} alt="" width={96} height={96} className="mx-auto" />
    <h2 id="redeem-error-title" className="mt-4 text-title-sm font-bold">{view.title}</h2>
    <p className="mt-3 text-body-sm text-ink-muted">{view.body}</p>
    {view.rows.length > 0 && <div className="mt-5 rounded-[16px] bg-subtle p-4 space-y-3 text-body-sm">{view.rows.map((row) => <div key={row.label} className="flex items-center justify-between gap-3"><span className="text-ink-muted">{row.label}</span><span className={row.danger ? "font-bold text-danger" : "font-bold"}>{row.oldValue && <><del className="font-normal text-ink-muted">{row.oldValue}</del> <Icon name="arrow-right" size={14} /> </>}<span className={row.oldValue ? "text-tone-amber-fg" : ""}>{row.value}</span></span></div>)}</div>}
    <div className="mt-6 space-y-1">{action(view.primary, true)}{action(view.secondary, false)}</div>
  </div>;
}
