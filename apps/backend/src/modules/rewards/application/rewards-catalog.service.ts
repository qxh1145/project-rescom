import {
  VoucherCatalogQuery,
  VoucherListItemDto,
  voucherDiscountPercent,
} from '@rescom/schemas';
import { effectivePrice } from '../domain/voucher-price';
import { effectiveStatus } from '../domain/voucher-availability';
import {
  FlashSaleReadPort,
  FlashSaleRecord,
} from './ports/flash-sale-read.port';
import {
  VoucherRecord,
  VoucherRepositoryPort,
} from './ports/voucher-repository.port';
import { WalletBalancePort } from './ports/wallet-balance.port';
import { RewardsException } from './exceptions/rewards.exceptions';

export interface RewardsCatalogDependencies {
  vouchers: VoucherRepositoryPort;
  flashSales: FlashSaleReadPort;
  wallet: WalletBalancePort;
  now: () => Date;
}

export class RewardsCatalogService {
  private readonly now: () => Date;
  constructor(private readonly deps: RewardsCatalogDependencies) {
    this.now = deps.now;
  }

  private item(
    v: VoucherRecord,
    flashes: FlashSaleRecord[],
    available: number,
    now: number,
  ): VoucherListItemDto {
    const match = flashes
      .flatMap((f) => f.items.map((item) => ({ flash: f, item })))
      .find(
        ({ flash, item }) =>
          item.voucherId === v.id &&
          flash.reservedAt !== null &&
          flash.settledAt === null &&
          Date.parse(flash.startsAt) <= now &&
          now < Date.parse(flash.endsAt) &&
          (!flash.endedEarlyAt || now < Date.parse(flash.endedEarlyAt)) &&
          item.sold < item.quota,
      );
    const price = effectivePrice(v, match?.item);
    return {
      id: v.id,
      title: v.title,
      brand: v.brand,
      category: v.category,
      valueVnd: v.valueVnd,
      price,
      status: effectiveStatus(v, now, !!match) as VoucherListItemDto['status'],
      stockTotal: v.stockTotal,
      stockRemaining: v.stockRemaining,
      redeemEndsAt: v.redeemEndsAt,
      codeExpiresAt: v.codeExpiresAt,
      flash: match
        ? {
            flashSaleId: match.flash.id,
            flashSaleItemId: match.item.id,
            quota: match.item.quota,
            sold: match.item.sold,
            endsAt: match.flash.endsAt,
          }
        : null,
      affordable: available >= price.points,
      imageUrl: v.imageUrl,
    };
  }

  async list(userId: string, query: VoucherCatalogQuery) {
    const now = this.now().getTime();
    const [vouchers, flashes, viewer] = await Promise.all([
      this.deps.vouchers.list(),
      this.deps.flashSales.list(),
      this.deps.wallet.getBalance(userId),
    ]);
    const categories = query.category;
    const brands = query.brand;
    const items = vouchers
      .filter((v) => v.isVisible && v.state !== 'ARCHIVED')
      .map((v) => ({
        record: v,
        item: this.item(v, flashes, viewer.available, now),
      }))
      .filter(
        ({ item: v }) =>
          (!query.q ||
            `${v.title} ${v.brand.name}`
              .toLocaleLowerCase('vi')
              .includes(query.q.toLocaleLowerCase('vi'))) &&
          (!categories?.length || categories.includes(v.category)) &&
          (!brands?.length || brands.includes(v.brand.id)) &&
          (query.minPoints === undefined ||
            v.price.points >= query.minPoints) &&
          (query.maxPoints === undefined ||
            v.price.points <= query.maxPoints) &&
          (!query.onSale || v.price.source !== 'BASE') &&
          (!query.affordable || v.affordable),
      );
    const rank = (v: VoucherListItemDto) =>
      v.status === 'AVAILABLE' || v.status === 'PAUSED' ? 0 : 1;
    items.sort(
      (a, b) =>
        rank(a.item) - rank(b.item) ||
        (query.sort === 'POINTS_ASC'
          ? a.item.price.points - b.item.price.points
          : query.sort === 'POINTS_DESC'
            ? b.item.price.points - a.item.price.points
            : query.sort === 'NEWEST'
              ? Date.parse(b.record.createdAt) - Date.parse(a.record.createdAt)
              : b.item.price.discountPercent - a.item.price.discountPercent ||
                Date.parse(b.record.createdAt) -
                  Date.parse(a.record.createdAt)) ||
        a.item.id.localeCompare(b.item.id),
    );
    const offset = query.offset ?? 0,
      limit = query.limit ?? 20;
    return {
      items: items.slice(offset, offset + limit).map(({ item }) => item),
      total: items.length,
      limit,
      offset,
      hasMore: offset + limit < items.length,
      serverTime: new Date(now).toISOString(),
      viewer,
    };
  }

  async detail(userId: string, id: string) {
    const now = this.now();
    const [voucher, flashes, viewer] = await Promise.all([
      this.deps.vouchers.findById(id),
      this.deps.flashSales.list(),
      this.deps.wallet.getBalance(userId),
    ]);
    if (!voucher || !voucher.isVisible || voucher.state === 'ARCHIVED')
      throw new RewardsException('VOUCHER_NOT_FOUND', 'VOUCHER_NOT_FOUND');
    return {
      voucher: {
        ...this.item(voucher, flashes, viewer.available, now.getTime()),
        description: voucher.description || voucher.title,
        whereToUse:
          voucher.whereToUse ||
          `Áp dụng tại hệ thống cửa hàng ${voucher.brand.name}`,
        terms: voucher.terms,
        howToUse: voucher.howToUse,
        isSharedCode: voucher.isSharedCode,
      },
      serverTime: now.toISOString(),
      viewer,
    };
  }

  async flashSalesList() {
    const now = this.now();
    const [flashes, vouchers] = await Promise.all([
      this.deps.flashSales.list(),
      this.deps.vouchers.list(),
    ]);
    const byId = new Map(
      vouchers
        .filter((v) => v.isVisible && v.state !== 'ARCHIVED')
        .map((v) => [v.id, v]),
    );
    return {
      serverTime: now.toISOString(),
      items: flashes
        .filter((f) => Date.parse(f.endsAt) > now.getTime() - 86400000)
        .map((f) => ({
          id: f.id,
          code: f.code,
          startsAt: f.startsAt,
          endsAt: f.endsAt,
          items: f.items
            .flatMap((item) => {
              const v = byId.get(item.voucherId);
              if (!v) return [];
              const isSettled = f.settledAt !== null;
              const isEnded =
                isSettled ||
                (f.endedEarlyAt &&
                  Date.parse(f.endedEarlyAt) <= now.getTime()) ||
                now.getTime() >= Date.parse(f.endsAt);
              const state =
                item.sold >= item.quota
                  ? 'SOLD_OUT'
                  : isEnded
                    ? 'ENDED'
                    : f.reservedAt === null ||
                        now.getTime() < Date.parse(f.startsAt)
                      ? 'UPCOMING'
                      : 'ACTIVE';
              return [
                {
                  id: item.id,
                  voucherId: item.voucherId,
                  voucherTitle: v.title,
                  brand: v.brand,
                  category: v.category,
                  valueVnd: v.valueVnd,
                  flashPoints: item.flashPoints,
                  basePoints: v.basePoints,
                  discountPercent: voucherDiscountPercent(
                    item.flashPoints,
                    v.basePoints,
                  ),
                  quota: item.quota,
                  sold: item.sold,
                  perUserCap: item.perUserCap,
                  state,
                },
              ];
            })
            .filter((item) => item.flashPoints < item.basePoints),
        }))
        .filter((f) => f.items.length > 0),
    };
  }
}
