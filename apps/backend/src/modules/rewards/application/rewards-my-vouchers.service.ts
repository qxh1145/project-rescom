import { randomUUID } from 'crypto';
import {
  VoucherTicketListDto,
  VoucherTicketResponseDto,
  CreateCodeIssueReportDto,
  CodeIssueReportDto,
  RedemptionHistoryQuery,
  RedemptionHistoryListDto,
} from '@rescom/schemas';
import { MyVouchersReadPort } from './ports/my-vouchers-read.port';
import { TicketWritePort } from './ports/ticket-write.port';
import { VoucherRepositoryPort } from './ports/voucher-repository.port';
import { UnitOfWorkPort } from '../../../common/database/unit-of-work.port';
import {
  TicketNotFoundException,
  TicketExpiredException,
  UndoWindowClosedException,
  CodeIssueAlreadyOpenException,
  TicketRefundedException,
  RewardsException,
} from './exceptions/rewards.exceptions';
import {
  markUsedDecision,
  undoUseDecision,
  codeIssueDecision,
  historyMonthSummary,
} from '../domain/ticket-rules';
import { uniqueViolationOf } from './unique-violation';

export interface RewardsMyVouchersServiceDependencies {
  readRepo: MyVouchersReadPort;
  ticketWrite: TicketWritePort;
  vouchers: VoucherRepositoryPort;
  unitOfWork: UnitOfWorkPort;
  now: () => Date;
}

export class RewardsMyVouchersService {
  private readonly now: () => Date;

  constructor(private readonly deps: RewardsMyVouchersServiceDependencies) {
    this.now = deps.now;
  }

  async listTickets(userId: string): Promise<VoucherTicketListDto> {
    const now = this.now();
    const serverTime = now.toISOString();
    const result = await this.deps.readRepo.listTickets(userId, now.getTime());
    return {
      items: result.items,
      total: result.total,
      serverTime,
    };
  }

  async getTicket(
    userId: string,
    ticketId: string,
  ): Promise<VoucherTicketResponseDto> {
    const now = this.now();
    const serverTime = now.toISOString();
    const result = await this.deps.readRepo.findTicket(
      userId,
      ticketId,
      now.getTime(),
    );
    if (!result) {
      throw new TicketNotFoundException(ticketId);
    }
    return {
      ticket: result.ticket,
      serverTime,
    };
  }

  async markUsed(
    userId: string,
    ticketId: string,
  ): Promise<VoucherTicketResponseDto> {
    return this.deps.unitOfWork.run(`ticket:${ticketId}:used`, async () => {
      const locked = await this.deps.ticketWrite.lockRedemption(ticketId);
      if (
        !locked ||
        locked.userId !== userId ||
        locked.status !== 'SUCCEEDED'
      ) {
        throw new TicketNotFoundException(ticketId);
      }
      const now = this.now();
      const serverTime = now.toISOString();

      const decision = markUsedDecision(
        {
          usedAt: locked.usedAt,
          undoUntil: locked.undoUntil,
          expiresAt: locked.codeExpiresAt,
          refunded: locked.refunded,
          openIssue: locked.latestReport
            ? { status: locked.latestReport.status }
            : null,
        },
        now.getTime(),
      );

      if (!decision.ok) {
        if (decision.code === 'TICKET_REFUNDED') {
          throw new TicketRefundedException();
        }
        if (decision.code === 'TICKET_EXPIRED') {
          throw new TicketExpiredException();
        }
        throw new RewardsException(decision.code as any, decision.code);
      }

      if (decision.changed) {
        const usedAt = new Date(decision.usedAt!);
        const undoUntil = new Date(decision.undoUntil!);
        await this.deps.ticketWrite.insertUsage({
          redemptionId: ticketId,
          usedAt,
          undoUntil,
        });

        await this.deps.vouchers.appendAudit({
          id: randomUUID(),
          idempotencyKey: `rewards:ticket:${ticketId}:used:${usedAt.getTime()}:${randomUUID()}`,
          eventType: 'REWARDS_TICKET_MARKED_USED',
          producer: 'rewards-my-vouchers',
          aggregateType: 'Redemption',
          aggregateId: ticketId,
          aggregateVersion: 1,
          correlationId: randomUUID(),
          payload: {
            redemptionId: ticketId,
            userId,
            usedAt: usedAt.toISOString(),
            undoUntil: undoUntil.toISOString(),
          },
        });
      }

      const updated = await this.deps.readRepo.findTicket(
        userId,
        ticketId,
        now.getTime(),
      );
      return {
        ticket: updated!.ticket,
        serverTime,
      };
    });
  }

  async undoUse(
    userId: string,
    ticketId: string,
  ): Promise<VoucherTicketResponseDto> {
    return this.deps.unitOfWork.run(`ticket:${ticketId}:undo`, async () => {
      const locked = await this.deps.ticketWrite.lockRedemption(ticketId);
      if (
        !locked ||
        locked.userId !== userId ||
        locked.status !== 'SUCCEEDED'
      ) {
        throw new TicketNotFoundException(ticketId);
      }
      const now = this.now();
      const serverTime = now.toISOString();

      const decision = undoUseDecision(
        {
          usedAt: locked.usedAt,
          undoUntil: locked.undoUntil,
          expiresAt: locked.codeExpiresAt,
          refunded: locked.refunded,
          openIssue: locked.latestReport
            ? { status: locked.latestReport.status }
            : null,
        },
        now.getTime(),
      );

      if (!decision.ok) {
        if (decision.code === 'TICKET_REFUNDED') {
          throw new TicketRefundedException();
        }
        if (decision.code === 'TICKET_EXPIRED') {
          throw new TicketExpiredException();
        }
        if (decision.code === 'UNDO_WINDOW_CLOSED') {
          throw new UndoWindowClosedException();
        }
        throw new RewardsException(decision.code as any, decision.code);
      }

      if (decision.changed) {
        await this.deps.ticketWrite.deleteUsage(ticketId);

        await this.deps.vouchers.appendAudit({
          id: randomUUID(),
          idempotencyKey: `rewards:ticket:${ticketId}:undone:${now.getTime()}:${randomUUID()}`,
          eventType: 'REWARDS_TICKET_USAGE_UNDONE',
          producer: 'rewards-my-vouchers',
          aggregateType: 'Redemption',
          aggregateId: ticketId,
          aggregateVersion: 1,
          correlationId: randomUUID(),
          payload: {
            redemptionId: ticketId,
            userId,
            undoneAt: now.toISOString(),
          },
        });
      }

      const updated = await this.deps.readRepo.findTicket(
        userId,
        ticketId,
        now.getTime(),
      );
      return {
        ticket: updated!.ticket,
        serverTime,
      };
    });
  }

  async reportCodeIssue(
    userId: string,
    ticketId: string,
    input: CreateCodeIssueReportDto,
  ): Promise<CodeIssueReportDto> {
    try {
      return await this.deps.unitOfWork.run(
        `ticket:${ticketId}:issue`,
        async () => {
          const locked = await this.deps.ticketWrite.lockRedemption(ticketId);
          if (
            !locked ||
            locked.userId !== userId ||
            locked.status !== 'SUCCEEDED'
          ) {
            throw new TicketNotFoundException(ticketId);
          }
          const now = this.now();

          const decision = codeIssueDecision(
            {
              usedAt: locked.usedAt,
              undoUntil: locked.undoUntil,
              expiresAt: locked.codeExpiresAt,
              refunded: locked.refunded,
              openIssue: locked.latestReport
                ? { status: locked.latestReport.status }
                : null,
            },
            now.getTime(),
          );

          if (!decision.ok) {
            if (decision.code === 'TICKET_REFUNDED') {
              throw new TicketRefundedException();
            }
            if (decision.code === 'TICKET_EXPIRED') {
              throw new TicketExpiredException();
            }
            if (decision.code === 'CODE_ISSUE_ALREADY_OPEN') {
              throw new CodeIssueAlreadyOpenException();
            }
            throw new RewardsException(decision.code as any, decision.code);
          }

          const reportId = randomUUID();
          await this.deps.ticketWrite.insertReport({
            id: reportId,
            redemptionId: ticketId,
            reason: input.reason,
            note: input.note?.trim() || null,
            createdAt: now,
          });

          await this.deps.vouchers.appendAudit({
            id: randomUUID(),
            idempotencyKey: `rewards:code-issue:${reportId}:reported`,
            eventType: 'REWARDS_CODE_ISSUE_REPORTED',
            producer: 'rewards-my-vouchers',
            aggregateType: 'CodeIssueReport',
            aggregateId: reportId,
            aggregateVersion: 1,
            correlationId: randomUUID(),
            payload: {
              reportId,
              redemptionId: ticketId,
              voucherId: locked.voucherId,
              reason: input.reason,
            },
          });

          return {
            id: reportId,
            redemptionId: ticketId,
            ticketId,
            reason: input.reason,
            note: input.note?.trim() || null,
            status: 'OPEN',
            createdAt: now.toISOString(),
            resolvedAt: null,
            replacementCode: null,
            refundReference: null,
          };
        },
      );
    } catch (error) {
      // insertReport only sets id + redemption_id, so any P2002 here is the
      // partial unique index on open reports (Prisma may report the column, not the index name).
      if (
        uniqueViolationOf(error) === 'code_issue_open' ||
        (error as { code?: string })?.code === 'P2002'
      ) {
        throw new CodeIssueAlreadyOpenException();
      }
      throw error;
    }
  }

  async history(
    userId: string,
    query: RedemptionHistoryQuery,
  ): Promise<RedemptionHistoryListDto> {
    const result = await this.deps.readRepo.listHistory(
      userId,
      query.limit,
      query.offset,
      this.now().getTime(),
    );
    const monthSummary = historyMonthSummary(
      result.monthSummaryRows,
      this.now().getTime(),
    );
    return {
      items: result.items,
      total: result.total,
      limit: query.limit,
      offset: query.offset,
      hasMore: query.offset + query.limit < result.total,
      monthSummary,
    };
  }
}
