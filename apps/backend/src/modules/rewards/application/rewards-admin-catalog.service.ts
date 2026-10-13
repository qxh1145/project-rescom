import { randomUUID } from 'crypto';
import { z } from 'zod';
import {
  RewardsException,
  RewardsErrorCode,
} from './exceptions/rewards.exceptions';
import {
  POINT_VND_RATE,
  rewardsAdminAuditEventPayloadSchema,
  adminVoucherInputSchema,
  adminVoucherPriceChangeSchema,
  adminVoucherStatePatchSchema,
  adminStockAdjustmentSchema,
  adminCodeImportRequestSchema,
  AdminVoucherListQueryDto,
} from '@rescom/schemas';
import {
  PassThroughUnitOfWork,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import { AdminCapabilityPort } from '../../economy/application/ports/admin-capability.port';
import { adminStockOf } from '../domain/voucher.entity';
import { adminVoucherStatus } from '../domain/voucher-availability';
import { effectivePrice } from '../domain/voucher-price';
import { stockAdjustmentDecision, importCodesDecision } from '../domain/stock';
import {
  FlashSaleReadPort,
  FlashSaleRecord,
} from './ports/flash-sale-read.port';
import { VoucherCodeRepositoryPort } from './ports/voucher-code-repository.port';
import {
  VoucherRecord,
  VoucherRepositoryPort,
} from './ports/voucher-repository.port';
import {
  REWARDS_ADMIN_AUDIT_PRODUCER,
  REWARDS_PRICE_DEVIATION_THRESHOLD_PERCENT,
} from './ports/rewards.constants';

type Input = ReturnType<typeof adminVoucherInputSchema.parse>;
type PriceInput = ReturnType<typeof adminVoucherPriceChangeSchema.parse>;
type StateInput = ReturnType<typeof adminVoucherStatePatchSchema.parse>;
type StockInput = ReturnType<typeof adminStockAdjustmentSchema.parse>;
type CodesInput = ReturnType<typeof adminCodeImportRequestSchema.parse>;
type Action =
  | 'VOUCHER_CREATED'
  | 'VOUCHER_UPDATED'
  | 'VOUCHER_STATE_CHANGED'
  | 'VOUCHER_PRICE_CHANGED'
  | 'VOUCHER_STOCK_ADJUSTED'
  | 'VOUCHER_CODES_IMPORTED';

export interface RewardsAdminCatalogDependencies {
  vouchers: VoucherRepositoryPort;
  codes: VoucherCodeRepositoryPort;
  flashSales: FlashSaleReadPort;
  adminCapability: AdminCapabilityPort;
  unitOfWork?: UnitOfWorkPort;
  now: () => Date;
  generateId?: () => string;
}

export class RewardsAdminCatalogService {
  private readonly now: () => Date;
  private readonly generateId: () => string;
  private readonly unitOfWork: UnitOfWorkPort;
  constructor(private readonly deps: RewardsAdminCatalogDependencies) {
    this.now = deps.now;
    this.generateId = deps.generateId ?? randomUUID;
    this.unitOfWork = deps.unitOfWork ?? new PassThroughUnitOfWork();
  }

  private fail(
    code: RewardsErrorCode,
    _status = 409,
    details: Record<string, unknown> = {},
  ): never {
    throw new RewardsException(code, code, details);
  }
  private async authorize(adminId: string) {
    const actor =
      await this.deps.adminCapability.findCurrentCapability(adminId);
    if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE')
      this.fail('REWARDS_ADMIN_CAPABILITY_REQUIRED', 403);
  }
  private async load(id: string) {
    const voucher = await this.deps.vouchers.findById(id);
    if (!voucher) this.fail('VOUCHER_NOT_FOUND', 404);
    return voucher;
  }
  private async mutable(id: string) {
    await this.deps.vouchers.lock(id);
    const voucher = await this.load(id);
    if (voucher.state === 'ARCHIVED') this.fail('VOUCHER_ARCHIVED');
    return voucher;
  }
  private deviation(v: VoucherRecord) {
    return (
      Math.round((v.basePoints / (v.valueVnd / POINT_VND_RATE) - 1) * 1000) / 10
    );
  }
  private reserved(v: VoucherRecord, flashes: FlashSaleRecord[], now: number) {
    return flashes
      .filter(
        (f) =>
          now < Date.parse(f.endsAt) &&
          (!f.endedEarlyAt || now < Date.parse(f.endedEarlyAt)),
      )
      .flatMap((f) => f.items)
      .filter((i) => i.voucherId === v.id)
      .reduce((n, i) => n + i.quota - i.sold, 0);
  }
  private row(v: VoucherRecord, flashes: FlashSaleRecord[], now: number) {
    const active = flashes
      .flatMap((f) => f.items.map((item) => ({ f, item })))
      .find(
        ({ f, item }) =>
          item.voucherId === v.id &&
          Date.parse(f.startsAt) <= now &&
          now < Date.parse(f.endsAt) &&
          (!f.endedEarlyAt || now < Date.parse(f.endedEarlyAt)) &&
          item.sold < item.quota,
      );
    return {
      id: v.id,
      title: v.title,
      brand: v.brand,
      category: v.category,
      valueVnd: v.valueVnd,
      price: effectivePrice(v, active?.item),
      basePoints: v.basePoints,
      promoPoints: v.promoPoints,
      state: v.state,
      status: adminVoucherStatus(v, now),
      isVisible: v.isVisible,
      stock: adminStockOf(v, this.reserved(v, flashes, now)),
      isSharedCode: v.isSharedCode,
      redeemStartsAt: v.redeemStartsAt,
      redeemEndsAt: v.redeemEndsAt,
      codeExpiresAt: v.codeExpiresAt,
      priceDeviationPercent: this.deviation(v),
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    };
  }
  private summary(
    v: VoucherRecord | null,
    extra: Record<string, unknown> = {},
  ) {
    return v
      ? {
          title: v.title,
          state: v.state,
          isVisible: v.isVisible,
          basePoints: v.basePoints,
          promoPoints: v.promoPoints,
          priceVersion: v.priceVersion,
          stockTotal: v.stockTotal,
          stockRemaining: v.stockRemaining,
          ...extra,
        }
      : null;
  }
  private async audit(
    action: Action,
    adminId: string,
    before: VoucherRecord | null,
    after: VoucherRecord,
    correlationId?: string,
    extra: Record<string, unknown> = {},
  ) {
    const id = z.string().uuid().safeParse(correlationId).success
      ? (correlationId as string)
      : this.generateId();
    const eventId = this.generateId();
    const payload = rewardsAdminAuditEventPayloadSchema.parse({
      schemaVersion: 1,
      auditCategory: 'REWARDS_ADMIN_ACTION',
      action,
      voucherId: after.id,
      adminId,
      before: this.summary(before),
      after: this.summary(after, extra),
      correlationId: id,
      occurredAt: this.now().toISOString(),
    });
    await this.deps.vouchers.appendAudit({
      id: eventId,
      idempotencyKey: `admin-audit:rewards:${after.id}:${id}:${eventId}`,
      eventType: action,
      producer: REWARDS_ADMIN_AUDIT_PRODUCER,
      aggregateType: 'Voucher',
      aggregateId: after.id,
      aggregateVersion: after.priceVersion,
      correlationId: id,
      payload,
    });
  }
  private async result(v: VoucherRecord) {
    return {
      voucher: this.row(
        v,
        await this.deps.flashSales.list(),
        this.now().getTime(),
      ),
    };
  }
  async brands() {
    return { items: await this.deps.vouchers.listBrands() };
  }
  async list(query: AdminVoucherListQueryDto = { filter: 'ALL' }) {
    const now = this.now();
    const [vouchers, flashes] = await Promise.all([
      this.deps.vouchers.list(),
      this.deps.flashSales.list(),
    ]);
    const all = vouchers.map((v) => this.row(v, flashes, now.getTime()));
    const items = all.filter(
      (v) =>
        (query.filter === 'ALL' || v.status === query.filter) &&
        (!query.q ||
          `${v.title} ${v.brand.name}`
            .toLocaleLowerCase('vi')
            .includes(query.q.toLocaleLowerCase('vi'))),
    );
    const count = (s: string) => all.filter((v) => v.status === s).length;
    return {
      items,
      summary: {
        total: all.length,
        active: count('ACTIVE'),
        paused: count('PAUSED'),
        soldOut: count('SOLD_OUT'),
        expired: count('EXPIRED'),
        hidden: count('HIDDEN'),
        archived: count('ARCHIVED'),
        lowStock: all
          .filter(
            (v) =>
              v.stock.remaining > 0 && v.stock.remaining <= v.stock.total * 0.1,
          )
          .map((v) => ({ voucherId: v.id, label: v.title })),
        codesAvailable: all.reduce((n, v) => n + v.stock.codesAvailable, 0),
        flashReserved: all.reduce((n, v) => n + v.stock.flashReserved, 0),
        activeFlashSales: flashes.filter(
          (f) =>
            Date.parse(f.startsAt) <= now.getTime() &&
            now.getTime() < Date.parse(f.endsAt) &&
            (!f.endedEarlyAt || now.getTime() < Date.parse(f.endedEarlyAt)),
        ).length,
      },
      serverTime: now.toISOString(),
    };
  }
  async detail(id: string) {
    const v = await this.load(id);
    const [flashes, priceHistory, redemptions] = await Promise.all([
      this.deps.flashSales.list(),
      this.deps.vouchers.priceHistory(id),
      this.deps.vouchers.redemptions(id, 50),
    ]);
    return {
      voucher: this.row(v, flashes, this.now().getTime()),
      priceHistory,
      redemptions: redemptions.map((r) => ({
        reference: r.reference,
        userLabel: `#${r.userId.slice(-4).toUpperCase()}`,
        points: r.points,
        kind: r.kind,
        createdAt: r.createdAt,
      })),
    };
  }
  async create(adminId: string, raw: Input, correlationId?: string) {
    const input = adminVoucherInputSchema.parse(raw);
    const id = this.generateId();
    return this.unitOfWork.run(`rewards-admin:${id}:create`, async () => {
      await this.authorize(adminId);
      const brand = (await this.deps.vouchers.listBrands()).find(
        (b) => b.id === input.brandId,
      );
      if (!brand) this.fail('BRAND_NOT_FOUND', 400, { path: 'brandId' });
      if (input.isSharedCode && !input.sharedCode)
        this.fail('SHARED_CODE_REQUIRED', 400, { path: 'sharedCode' });
      const now = this.now().toISOString();
      const v: VoucherRecord = {
        id,
        title: input.title,
        brand,
        category: input.category,
        valueVnd: input.valueVnd,
        basePoints: input.basePoints,
        promoPoints: input.promoPoints,
        priceVersion: 1,
        stockTotal: 0,
        stockRemaining: 0,
        codesAvailable: input.sharedCode ? 1 : 0,
        state: 'ACTIVE',
        isVisible: true,
        isSharedCode: input.isSharedCode,
        sharedCode: input.sharedCode ?? null,
        redeemStartsAt: input.redeemStartsAt,
        redeemEndsAt: input.redeemEndsAt,
        codeExpiresAt: input.codeExpiresAt,
        description: null,
        whereToUse: null,
        terms: input.terms,
        howToUse: input.howToUse,
        imageUrl: input.imageUrl,
        createdAt: now,
        updatedAt: now,
        createdById: adminId,
      };
      const saved = await this.deps.vouchers.create(v);
      await this.deps.vouchers.appendPriceVersion(
        id,
        1,
        v.basePoints,
        v.promoPoints,
        adminId,
        now,
      );
      await this.audit('VOUCHER_CREATED', adminId, null, saved, correlationId, {
        deviation:
          this.deviation(saved) > REWARDS_PRICE_DEVIATION_THRESHOLD_PERCENT,
      });
      return this.result(saved);
    });
  }
  async update(
    id: string,
    adminId: string,
    raw: Input,
    correlationId?: string,
  ) {
    const input = adminVoucherInputSchema.parse(raw);
    return this.unitOfWork.run(`rewards-admin:${id}:update`, async () => {
      await this.authorize(adminId);
      const before = await this.mutable(id);
      const brand = (await this.deps.vouchers.listBrands()).find(
        (b) => b.id === input.brandId,
      );
      if (!brand) this.fail('BRAND_NOT_FOUND', 400, { path: 'brandId' });
      const sharedCode = input.isSharedCode
        ? (input.sharedCode ?? before.sharedCode)
        : null;
      if (input.isSharedCode && !sharedCode)
        this.fail('SHARED_CODE_REQUIRED', 400, { path: 'sharedCode' });
      if (
        input.isSharedCode !== before.isSharedCode &&
        (before.stockTotal > 0 || (await this.deps.codes.hasIssued(id)))
      )
        this.fail('SHARED_FLAG_LOCKED');
      if (
        Date.parse(input.redeemEndsAt) <= this.now().getTime() &&
        input.redeemEndsAt !== before.redeemEndsAt
      )
        this.fail('REDEMPTION_WINDOW_ENDED', 400, { path: 'redeemEndsAt' });
      const saved = await this.deps.vouchers.save({
        ...before,
        title: input.title,
        brand,
        category: input.category,
        valueVnd: input.valueVnd,
        isSharedCode: input.isSharedCode,
        sharedCode,
        redeemStartsAt: input.redeemStartsAt,
        redeemEndsAt: input.redeemEndsAt,
        codeExpiresAt: input.codeExpiresAt,
        terms: input.terms.length ? input.terms : before.terms,
        howToUse: input.howToUse.length ? input.howToUse : before.howToUse,
        imageUrl: input.imageUrl,
        updatedAt: this.now().toISOString(),
      });
      await this.audit(
        'VOUCHER_UPDATED',
        adminId,
        before,
        saved,
        correlationId,
      );
      return this.result(saved);
    });
  }
  async patch(
    id: string,
    adminId: string,
    raw: StateInput,
    correlationId?: string,
  ) {
    const input = adminVoucherStatePatchSchema.parse(raw);
    return this.unitOfWork.run(`rewards-admin:${id}:patch`, async () => {
      await this.authorize(adminId);
      const before = await this.mutable(id);
      const state = input.state ?? before.state,
        isVisible = input.isVisible ?? before.isVisible;
      if (state === before.state && isVisible === before.isVisible)
        return this.result(before);
      const saved = await this.deps.vouchers.save({
        ...before,
        state,
        isVisible,
        updatedAt: this.now().toISOString(),
      });
      await this.audit(
        'VOUCHER_STATE_CHANGED',
        adminId,
        before,
        saved,
        correlationId,
      );
      return this.result(saved);
    });
  }
  async changePrice(
    id: string,
    adminId: string,
    raw: PriceInput,
    correlationId?: string,
  ) {
    const input = adminVoucherPriceChangeSchema.parse(raw);
    return this.unitOfWork.run(`rewards-admin:${id}:price`, async () => {
      await this.authorize(adminId);
      const before = await this.mutable(id);
      const now = this.now().toISOString();
      const saved = await this.deps.vouchers.save({
        ...before,
        ...input,
        priceVersion: before.priceVersion + 1,
        updatedAt: now,
      });
      await this.deps.vouchers.appendPriceVersion(
        id,
        saved.priceVersion,
        saved.basePoints,
        saved.promoPoints,
        adminId,
        now,
      );
      await this.audit(
        'VOUCHER_PRICE_CHANGED',
        adminId,
        before,
        saved,
        correlationId,
        {
          deviation:
            this.deviation(saved) > REWARDS_PRICE_DEVIATION_THRESHOLD_PERCENT,
        },
      );
      return this.result(saved);
    });
  }
  async adjustStock(
    id: string,
    adminId: string,
    raw: StockInput,
    correlationId?: string,
  ) {
    const input = adminStockAdjustmentSchema.parse(raw);
    return this.unitOfWork.run(`rewards-admin:${id}:stock`, async () => {
      await this.authorize(adminId);
      const before = await this.mutable(id);
      const flashes = await this.deps.flashSales.list();
      const decision = stockAdjustmentDecision(
        before,
        adminStockOf(
          before,
          this.reserved(before, flashes, this.now().getTime()),
        ),
        input.total,
      );
      if (!decision.ok)
        this.fail(
          decision.code as RewardsErrorCode,
          decision.status,
          'details' in decision ? decision.details : {},
        );
      const saved = await this.deps.vouchers.adjustStock(
        id,
        input.total,
        before.stockRemaining,
        this.now().toISOString(),
      );
      if (!saved) this.fail('STOCK_BELOW_COMMITTED');
      if (decision.removeCodes > 0 && !before.isSharedCode)
        if (
          (await this.deps.codes.removeAvailable(id, decision.removeCodes)) !==
          decision.removeCodes
        )
          this.fail('STOCK_EXCEEDS_CODES');
      await this.audit(
        'VOUCHER_STOCK_ADJUSTED',
        adminId,
        before,
        saved,
        correlationId,
      );
      return this.result(saved);
    });
  }
  async importCodes(
    id: string,
    adminId: string,
    raw: CodesInput,
    correlationId?: string,
  ) {
    const input = adminCodeImportRequestSchema.parse(raw);
    try {
      return await this.unitOfWork.run(
        `rewards-admin:${id}:codes`,
        async () => {
          await this.authorize(adminId);
          const before = await this.mutable(id);
          if (before.isSharedCode) this.fail('SHARED_CODE_VOUCHER');
          const decision = importCodesDecision(
            input.codes,
            await this.deps.codes.listCodes(id),
          );
          if (input.mode === 'VALIDATE' || !decision.accepted) return decision;
          await this.deps.codes.importCodes(
            id,
            input.codes.map((c) => c.trim()),
          );
          const saved = await this.deps.vouchers.adjustStock(
            id,
            before.stockTotal + input.codes.length,
            before.stockRemaining,
            this.now().toISOString(),
          );
          if (!saved) this.fail('STOCK_BELOW_COMMITTED');
          await this.audit(
            'VOUCHER_CODES_IMPORTED',
            adminId,
            before,
            saved,
            correlationId,
            { codesImported: input.codes.length },
          );
          return { ...decision, committed: true };
        },
      );
    } catch (error) {
      if (
        input.mode !== 'COMMIT' ||
        !(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'P2002'
        )
      )
        throw error;
      const decision = importCodesDecision(
        input.codes,
        await this.deps.codes.listCodes(id),
      );
      if (!decision.alreadyStored.length) throw error;
      return decision;
    }
  }
}
