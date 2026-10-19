import { Inject, Injectable } from '@nestjs/common';
import {
  AdminPointCreditDto,
  CreateAdminPointCreditDto,
} from '@rescom/schemas';
import {
  UNIT_OF_WORK_PORT,
  UnitOfWorkPort,
} from '../../../common/database/unit-of-work.port';
import {
  IDENTITY_AUDIT_PORT,
  IdentityAuditPort,
} from '../../auth/application/ports/identity-audit.port';
import { UserNotFoundException } from '../../users/application/exceptions/user-admin.exceptions';
import {
  ADMIN_CAPABILITY_PORT,
  AdminCapabilityPort,
} from './ports/admin-capability.port';
import {
  ADMIN_POINT_CREDIT_OUTBOX_PORT,
  AdminPointCreditOutboxPort,
} from './ports/admin-point-credit-outbox.port';
import { LedgerService } from './ledger.service';
import {
  AdminPointCreditCapabilityRequiredException,
  AdminSelfCreditForbiddenException,
  IdempotencyConflictException,
  UserBannedException,
} from './exceptions/economy.exceptions';

@Injectable()
export class AdminPointCreditService {
  constructor(
    private readonly ledgerService: LedgerService,
    @Inject(ADMIN_CAPABILITY_PORT)
    private readonly adminCapability: AdminCapabilityPort,
    @Inject(UNIT_OF_WORK_PORT)
    private readonly unitOfWork: UnitOfWorkPort,
    @Inject(IDENTITY_AUDIT_PORT)
    private readonly audit: IdentityAuditPort,
    @Inject(ADMIN_POINT_CREDIT_OUTBOX_PORT)
    private readonly outbox: AdminPointCreditOutboxPort,
  ) {}

  async credit(
    actorId: string,
    targetUserId: string,
    input: CreateAdminPointCreditDto,
  ): Promise<AdminPointCreditDto> {
    return this.unitOfWork.run(
      `admin-credit:${input.idempotencyKey}`,
      async () => {
        // (a) Live actor capability re-check
        const actorCapability =
          await this.adminCapability.findCurrentCapability(actorId);
        if (
          !actorCapability ||
          actorCapability.role !== 'ADMIN' ||
          actorCapability.status !== 'ACTIVE'
        ) {
          throw new AdminPointCreditCapabilityRequiredException();
        }

        // (b) Self-credit forbidden
        if (targetUserId === actorId) {
          throw new AdminSelfCreditForbiddenException();
        }

        // (c) Existing journal replay check
        const existingJournal = await this.ledgerService.findAdminCreditJournal(
          input.idempotencyKey,
        );
        if (existingJournal) {
          // Read-only lookup: a replay must not create accounts for the target.
          const targetAvailable = (
            await this.ledgerService.getUserAccounts(targetUserId)
          ).find((a) => a.accountClass === 'USER_AVAILABLE');
          const matchesTarget =
            targetAvailable !== undefined &&
            existingJournal.entries.some(
              (e) =>
                e.accountId === targetAvailable.id && e.amount === input.amount,
            );
          if (!matchesTarget) {
            throw new IdempotencyConflictException(
              `A credit journal with key "${input.idempotencyKey}" already exists with different transaction parameters.`,
            );
          }
          return {
            journalId: existingJournal.id,
            userId: targetUserId,
            amount: input.amount,
            reason: existingJournal.description ?? input.reason,
            createdAt: existingJournal.createdAt.toISOString(),
            replayed: true,
          };
        }

        // (d) Target capability check
        const targetCapability =
          await this.adminCapability.findCurrentCapability(targetUserId);
        if (!targetCapability) {
          throw new UserNotFoundException();
        }
        if (targetCapability.status === 'LOCKED') {
          throw new UserBannedException();
        }

        // (e) Post credit journal
        const journal = await this.ledgerService.creditAdminPoints({
          userId: targetUserId,
          amount: input.amount,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        });

        // (f) Identity audit row
        await this.audit.append({
          action: 'ADMIN_POINTS_CREDITED',
          userId: actorId,
          targetUserId,
          outcome: 'SUCCESS',
          errorCode: null,
          metadata: {
            journalId: journal.id,
            amount: input.amount,
            reason: input.reason.trim(),
          },
        });

        // (g) Enqueue outbox notification event
        await this.outbox.enqueueCredited({
          journalId: journal.id,
          userId: targetUserId,
          amount: input.amount,
          reason: input.reason.trim(),
          actorId,
        });

        return {
          journalId: journal.id,
          userId: targetUserId,
          amount: input.amount,
          reason: input.reason.trim(),
          createdAt: journal.createdAt.toISOString(),
          replayed: false,
        };
      },
    );
  }
}
