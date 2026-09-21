import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  postJournalInputSchema,
  PostJournalInput,
  reverseJournalInputSchema,
  ReverseJournalInput,
  LedgerJournalDto,
  LedgerAccountDto,
} from '@rescom/schemas';
import { LedgerService } from '../application/ledger.service';
import { SessionAuthGuard } from '../../auth/presentation/guards/session-auth.guard';
import { CsrfGuard } from '../../auth/presentation/guards/csrf.guard';
import { CurrentUser } from '../../auth/presentation/decorators';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';
import { JsonOnlyGuard } from '../../../common/http/json-only.guard';
import { ParseUUIDPipe } from '../../../common/http/parse-uuid.pipe';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe';
import { createSuccessEnvelope } from '../../../common/http/response.envelope';
import { LedgerJournalEntity } from '../domain/ledger-journal.entity';
import { LedgerAccountEntity } from '../domain/ledger-account.entity';

@Controller('economy')
@UseGuards(SessionAuthGuard)
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Post('journals')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
  @UsePipes(new ZodValidationPipe(postJournalInputSchema, 'JOURNAL_UNBALANCED'))
  async postJournal(@Body() body: PostJournalInput) {
    const journal = await this.ledgerService.postJournal(body);
    return createSuccessEnvelope(this.serializeJournal(journal));
  }

  @Post('journals/:id/reverse')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard, JsonOnlyGuard)
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

  @Get('accounts/me')
  async getMyAccounts(@CurrentUser() user: AuthenticatedUser) {
    const accounts = await this.ledgerService.getUserAccounts(user.id);
    return createSuccessEnvelope(
      accounts.map((a) => this.serializeAccount(a)),
    );
  }

  @Get('accounts/:id/balance')
  async getAccountBalance(@Param('id', ParseUUIDPipe) id: string) {
    const verification = await this.ledgerService.verifyAccountBalance(id);
    return createSuccessEnvelope(verification);
  }

  @Post('accounts/:id/reconcile')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  async reconcileAccount(@Param('id', ParseUUIDPipe) id: string) {
    const result = await this.ledgerService.reconcileAccountBalance(id);
    return createSuccessEnvelope(result);
  }

  @Get('integrity')
  async verifyLedgerIntegrity() {
    const report = await this.ledgerService.verifyLedgerIntegrity();
    return createSuccessEnvelope(report);
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
