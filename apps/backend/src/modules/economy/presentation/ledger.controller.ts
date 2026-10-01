import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  postJournalInputSchema,
  PostJournalInput,
  ReverseJournalInput,
  LedgerJournalDto,
  LedgerAccountDto,
  releaseMaturedPendingRewardsSchema,
  ReleaseMaturedPendingRewardsInput,
  releasePendingRewardRequestSchema,
  ReleasePendingRewardRequest,
} from '@rescom/schemas';
import { LedgerService } from '../application/ledger.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser, Roles } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';
import { RewardSettlementCoordinator } from '../application/reward-settlement.coordinator';
import { PendingRewardForbiddenException } from '../application/exceptions/economy.exceptions';

@Controller(['economy', 'api/economy'])
@UseGuards(SessionAuthGuard)
export class LedgerController {
  private readonly coordinator: RewardSettlementCoordinator;

  constructor(
    private readonly ledgerService: LedgerService,
    coordinator?: RewardSettlementCoordinator,
  ) {
    this.coordinator =
      coordinator ?? new RewardSettlementCoordinator(ledgerService);
  }

  @Post('journals')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard, CsrfGuard, JsonOnlyGuard)
  @Roles('ADMIN')
  @UsePipes(new ZodValidationPipe(postJournalInputSchema, 'JOURNAL_UNBALANCED'))
  async postJournal(@Body() body: PostJournalInput) {
    const journal = await this.ledgerService.postJournal(body);
    return createSuccessEnvelope(this.serializeJournal(journal));
  }

  @Post('journals/:id/reverse')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RolesGuard, CsrfGuard, JsonOnlyGuard)
  @Roles('ADMIN')
  async reverseJournal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: Partial<ReverseJournalInput>,
  ) {
    const journal = await this.ledgerService.reverseJournal({
      targetJournalId: id,
      idempotencyKey: body?.idempotencyKey,
      reason: body?.reason,
    });
    return createSuccessEnvelope(this.serializeJournal(journal));
  }

  @Get('wallet')
  async getWallet(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) : 50;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    const wallet = await this.ledgerService.getWallet(
      user.id,
      Number.isNaN(parsedLimit) ? 50 : parsedLimit,
      Number.isNaN(parsedOffset) ? 0 : parsedOffset,
    );
    return createSuccessEnvelope(wallet);
  }

  @Get('accounts/me')
  async getMyAccounts(@CurrentUser() user: AuthenticatedUser) {
    const accounts = await this.ledgerService.getUserAccounts(user.id);
    return createSuccessEnvelope(accounts.map((a) => this.serializeAccount(a)));
  }

  @Get('accounts/:id/balance')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getAccountBalance(@Param('id', ParseUUIDPipe) id: string) {
    const verification = await this.ledgerService.verifyAccountBalance(id);
    return createSuccessEnvelope(verification);
  }

  @Post('accounts/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, CsrfGuard)
  @Roles('ADMIN')
  async reconcileAccount(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.ledgerService.reconcileAccountBalance(id);
    return createSuccessEnvelope(result);
  }

  @Get('integrity')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async verifyLedgerIntegrity() {
    const report = await this.ledgerService.verifyLedgerIntegrity();
    return createSuccessEnvelope(report);
  }

  // Epic 6 review P1: the Internal/External reward credit endpoints moved to
  // the Participation-owned Admin re-drive controller
  // (`participation/presentation/admin-reward-redrive.controller.ts`), which
  // derives every settlement parameter server-side.

  /**
   * Releases one matured Pending reward (FR-24). The respondent, the amount
   * and the 48-hour maturity come from the credit journal (Epic 6 review
   * P2): a respondent can only release their own matured credit; an Admin
   * may release anyone's and may name the expected respondent.
   */
  @Post('rewards/release-pending/:attemptId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, CsrfGuard, JsonOnlyGuard)
  @Roles('ADMIN', 'RESPONDENT')
  async releasePendingReward(
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
    @Body(new ZodValidationPipe(releasePendingRewardRequestSchema))
    body: ReleasePendingRewardRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const isAdmin = user.role === 'ADMIN';
    // A respondent releases only their own credit; naming anyone else is
    // refused rather than silently ignored.
    if (!isAdmin && body?.respondentId && body.respondentId !== user.id) {
      throw new PendingRewardForbiddenException();
    }
    const journal = await this.coordinator.releasePendingReward({
      attemptId,
      respondentId: isAdmin ? body?.respondentId : user.id,
    });
    return createSuccessEnvelope(this.serializeJournal(journal));
  }

  /**
   * Admin trigger of the FR-24 maturity scan (AC6.4). Since Story IR.2b the
   * `pending-release` scheduler job runs the same scan; this endpoint stays
   * the operator fallback (pass `after` = the previous `nextCursor` to page).
   */
  @Post('rewards/release-matured')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard, CsrfGuard, JsonOnlyGuard)
  @Roles('ADMIN')
  async releaseMaturedPendingRewards(
    @Body(new ZodValidationPipe(releaseMaturedPendingRewardsSchema))
    body: ReleaseMaturedPendingRewardsInput,
  ) {
    const summary = await this.coordinator.releaseMaturedPendingRewards({
      cutoffDate: body?.cutoffDate ? new Date(body.cutoffDate) : undefined,
      limit: body?.limit,
      after: body?.after,
    });
    return createSuccessEnvelope(summary);
  }

  private serializeJournal(journal: LedgerJournalEntity): LedgerJournalDto {
    return {
      id: journal.id,
      idempotencyKey: journal.idempotencyKey,
      description: journal.description,
      reversesJournalId: journal.reversesJournalId,
      createdAt: journal.createdAt.toISOString(),
      entries: journal.entries.map((e) => ({
        id: e.id,
        journalId: e.journalId,
        accountId: e.accountId,
        amount: e.amount,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  private serializeAccount(account: LedgerAccountEntity): LedgerAccountDto {
    return {
      id: account.id,
      userId: account.userId,
      accountClass: account.accountClass,
      currency: account.currency,
      balance: account.balance,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }
}
