import { randomUUID } from 'crypto';
import {
  AdminCodeIssueListDto,
  AdminCodeIssueDto,
  AdminCodeIssueListQuery,
  AdminResolveCodeIssueDto,
} from '@rescom/schemas';
import { TicketWritePort } from './ports/ticket-write.port';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';
import { ReverseSpendPort } from './ports/reverse-spend.port';
import { AdminCapabilityPort } from '../../economy/application/ports/admin-capability.port';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import {
  CodeIssueNotFoundException,
  CodeIssueAlreadyResolvedException,
  TicketNotFoundException,
  TicketRefundedException,
  TicketExpiredException,
  NoReplacementAvailableException,
  ReplacementNotSupportedException,
  RewardsException,
} from './exceptions/rewards.exceptions';
import { resolveDecision } from '../domain/code-issue-resolution';
import { generateRefundReference } from '../domain/redemption-reference';
import { uniqueViolationOf } from './unique-violation';

const MAX_REFERENCE_ATTEMPTS = 3;

export interface RewardsAdminCodeIssuesServiceDependencies {
  ticketWrite: TicketWritePort;
  vouchers: VoucherRepositoryPort;
  unitOfWork: UnitOfWorkPort;
  adminCapability: AdminCapabilityPort;
  reverseSpend: ReverseSpendPort;
  now: () => Date;
}

export class RewardsAdminCodeIssuesService {
  private readonly now: () => Date;

  constructor(
    private readonly deps: RewardsAdminCodeIssuesServiceDependencies,
  ) {
    this.now = deps.now;
  }

  private async authorize(adminUserId: string): Promise<void> {
    const actor =
      await this.deps.adminCapability.findCurrentCapability(adminUserId);
    if (!actor || actor.role !== 'ADMIN' || actor.status !== 'ACTIVE') {
      throw new RewardsException(
        'REWARDS_ADMIN_CAPABILITY_REQUIRED',
        'Admin capability required',
      );
    }
  }

  async list(
    query: AdminCodeIssueListQuery,
    adminUserId: string,
  ): Promise<AdminCodeIssueListDto> {
    await this.authorize(adminUserId);
    const now = this.now();
    const result = await this.deps.ticketWrite.listReportsForAdmin(
      query,
      now.getTime(),
    );
    return {
      items: result.items,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + query.limit < result.total,
      summary: {
        open: result.openCount,
        oldestOpenAt: result.oldestOpenAt,
      },
    };
  }

  async get(id: string, adminUserId: string): Promise<AdminCodeIssueDto> {
    await this.authorize(adminUserId);
    const now = this.now();
    const item = await this.deps.ticketWrite.findReportForAdmin(
      id,
      now.getTime(),
    );
    if (!item) {
      throw new CodeIssueNotFoundException(id);
    }
    return item;
  }

  async resolve(
    id: string,
    input: AdminResolveCodeIssueDto,
    admin: { id: string; name: string },
  ): Promise<AdminCodeIssueDto> {
    await this.authorize(admin.id);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      try {
        return await this.deps.unitOfWork.run(
          `code-issue:${id}:resolve`,
          async () => {
            const lockedReport = await this.deps.ticketWrite.lockReport(id);
            if (!lockedReport) {
              throw new CodeIssueNotFoundException(id);
            }

            if (lockedReport.status !== 'OPEN') {
              const isSameOutcome =
                (lockedReport.status === 'REPLACED' &&
                  input.outcome === 'REPLACE') ||
                (lockedReport.status === 'REFUNDED' &&
                  input.outcome === 'REFUND') ||
                (lockedReport.status === 'REJECTED' &&
                  input.outcome === 'REJECT');

              if (isSameOutcome) {
                const stored = await this.deps.ticketWrite.findReportForAdmin(
                  id,
                  this.now().getTime(),
                );
                return stored!;
              }
              throw new CodeIssueAlreadyResolvedException();
            }

            const lockedRedemption = await this.deps.ticketWrite.lockRedemption(
              lockedReport.redemptionId,
            );
            if (!lockedRedemption) {
              throw new TicketNotFoundException(lockedReport.redemptionId);
            }

            const now = this.now();

            if (input.outcome === 'REJECT') {
              const affected = await this.deps.ticketWrite.markReportRejected(
                id,
                admin.id,
                now,
                input.note.trim(),
              );
              if (!affected) {
                throw new CodeIssueAlreadyResolvedException();
              }

              await this.deps.vouchers.appendAudit({
                id: randomUUID(),
                idempotencyKey: `rewards:code-issue:${id}:resolved`,
                eventType: 'REWARDS_CODE_ISSUE_RESOLVED',
                producer: 'rewards-admin-code-issues',
                aggregateType: 'CodeIssueReport',
                aggregateId: id,
                aggregateVersion: 2,
                correlationId: randomUUID(),
                payload: {
                  reportId: id,
                  redemptionId: lockedRedemption.id,
                  userId: lockedRedemption.userId,
                  voucherId: lockedRedemption.voucherId,
                  outcome: 'REJECTED',
                },
              });

              return (await this.deps.ticketWrite.findReportForAdmin(
                id,
                now.getTime(),
              ))!;
            }

            if (input.outcome === 'REPLACE') {
              await this.deps.vouchers.lock(lockedRedemption.voucherId);
              const voucher = await this.deps.vouchers.findById(
                lockedRedemption.voucherId,
              );
              if (!voucher) {
                throw new RewardsException(
                  'VOUCHER_NOT_FOUND',
                  `Voucher ${lockedRedemption.voucherId} not found`,
                );
              }

              const decision = resolveDecision(
                { id, status: lockedReport.status },
                {
                  expiresAt: lockedRedemption.codeExpiresAt,
                  refunded: lockedRedemption.refunded,
                },
                {
                  isSharedCode: voucher.isSharedCode,
                  stockRemaining: voucher.stockRemaining,
                  codesAvailable: voucher.codesAvailable,
                },
                'REPLACE',
                now.getTime(),
              );

              if (!decision.ok) {
                if (decision.code === 'REPLACEMENT_NOT_SUPPORTED') {
                  throw new ReplacementNotSupportedException();
                }
                if (decision.code === 'TICKET_EXPIRED') {
                  throw new TicketExpiredException();
                }
                if (decision.code === 'NO_REPLACEMENT_AVAILABLE') {
                  throw new NoReplacementAvailableException();
                }
                throw new RewardsException(decision.code as any, decision.code);
              }

              const decremented =
                await this.deps.vouchers.decrementRegularStock(
                  voucher.id,
                  now.toISOString(),
                );
              if (!decremented) {
                throw new NoReplacementAvailableException();
              }

              const replacementCode =
                await this.deps.ticketWrite.claimReplacementCode(
                  voucher.id,
                  id,
                );
              if (!replacementCode) {
                throw new NoReplacementAvailableException();
              }

              const affected = await this.deps.ticketWrite.markReportReplaced(
                id,
                replacementCode.id,
                admin.id,
                now,
                input.note?.trim() || null,
              );
              if (!affected) {
                throw new CodeIssueAlreadyResolvedException();
              }

              // the new code has never been used
              await this.deps.ticketWrite.deleteUsage(lockedRedemption.id);

              await this.deps.vouchers.appendAudit({
                id: randomUUID(),
                idempotencyKey: `rewards:code-issue:${id}:resolved`,
                eventType: 'REWARDS_CODE_ISSUE_RESOLVED',
                producer: 'rewards-admin-code-issues',
                aggregateType: 'CodeIssueReport',
                aggregateId: id,
                aggregateVersion: 2,
                correlationId: randomUUID(),
                payload: {
                  reportId: id,
                  redemptionId: lockedRedemption.id,
                  userId: lockedRedemption.userId,
                  voucherId: lockedRedemption.voucherId,
                  outcome: 'REPLACED',
                },
              });

              return (await this.deps.ticketWrite.findReportForAdmin(
                id,
                now.getTime(),
              ))!;
            }

            if (input.outcome === 'REFUND') {
              if (lockedRedemption.refunded) {
                throw new TicketRefundedException();
              }
              if (lockedRedemption.status !== 'SUCCEEDED') {
                throw new TicketNotFoundException(lockedRedemption.id);
              }
              if (!lockedRedemption.journalId) {
                throw new RewardsException(
                  'REDEMPTION_NOT_FOUND',
                  `Redemption ${lockedRedemption.id} has no journalId`,
                );
              }

              const reverseResult = await this.deps.reverseSpend.reverseSpend({
                journalId: lockedRedemption.journalId,
                idempotencyKey: `redemption-refund:${id}`,
                reason: `Redemption refund for code issue ${id}`,
              });

              const refundRef = generateRefundReference(now.getUTCFullYear());
              await this.deps.ticketWrite.insertRefund({
                id: randomUUID(),
                redemptionId: lockedRedemption.id,
                reportId: id,
                journalId: reverseResult.journalId,
                reference: refundRef,
                points: lockedRedemption.pricePoints,
                createdAt: now,
              });

              await this.deps.ticketWrite.deleteFlashClaim(lockedRedemption.id);

              const affected = await this.deps.ticketWrite.markReportRefunded(
                id,
                reverseResult.journalId,
                admin.id,
                now,
                input.note?.trim() || null,
              );
              if (!affected) {
                throw new CodeIssueAlreadyResolvedException();
              }

              await this.deps.vouchers.appendAudit({
                id: randomUUID(),
                idempotencyKey: `rewards:code-issue:${id}:resolved`,
                eventType: 'REWARDS_CODE_ISSUE_RESOLVED',
                producer: 'rewards-admin-code-issues',
                aggregateType: 'CodeIssueReport',
                aggregateId: id,
                aggregateVersion: 2,
                correlationId: randomUUID(),
                payload: {
                  reportId: id,
                  redemptionId: lockedRedemption.id,
                  userId: lockedRedemption.userId,
                  voucherId: lockedRedemption.voucherId,
                  outcome: 'REFUNDED',
                  refundReference: refundRef,
                },
              });

              return (await this.deps.ticketWrite.findReportForAdmin(
                id,
                now.getTime(),
              ))!;
            }

            throw new RewardsException(
              'VALIDATION_ERROR' as any,
              'Invalid outcome',
            );
          },
        );
      } catch (error) {
        lastError = error;
        if (
          input.outcome === 'REFUND' &&
          uniqueViolationOf(error) === 'reference' &&
          attempt < MAX_REFERENCE_ATTEMPTS
        ) {
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }
}
