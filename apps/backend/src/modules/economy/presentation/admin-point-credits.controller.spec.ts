import { AdminPointCreditsController } from './admin-point-credits.controller';
import { AdminPointCreditService } from '../application/admin-point-credit.service';
import { LedgerService } from '../application/ledger.service';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('AdminPointCreditsController', () => {
  let controller: AdminPointCreditsController;
  let creditService: jest.Mocked<AdminPointCreditService>;
  let ledgerService: jest.Mocked<LedgerService>;

  const mockAdmin: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'admin@example.com',
    role: 'ADMIN',
    status: 'ACTIVE',
  };

  const targetId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    creditService = {
      credit: jest.fn(),
    } as unknown as jest.Mocked<AdminPointCreditService>;

    ledgerService = {
      listAdminCredits: jest.fn(),
    } as unknown as jest.Mocked<LedgerService>;

    controller = new AdminPointCreditsController(creditService, ledgerService);
  });

  it('creditPoints delegates to AdminPointCreditService.credit', async () => {
    const input = {
      amount: 100,
      reason: 'Hỗ trợ khách hàng sự cố',
      idempotencyKey: '33333333-3333-4333-8333-333333333333',
    };
    const expected = {
      journalId: '44444444-4444-4444-8444-444444444444',
      userId: targetId,
      amount: 100,
      reason: input.reason,
      createdAt: new Date().toISOString(),
      replayed: false,
    };
    creditService.credit.mockResolvedValue(expected);

    const result = await controller.creditPoints(targetId, mockAdmin, input);

    expect(result.data).toBe(expected);
    expect(creditService.credit).toHaveBeenCalledWith(
      mockAdmin.id,
      targetId,
      input,
    );
  });

  it('listCredits delegates to LedgerService.listAdminCredits and serializes dates', async () => {
    const now = new Date();
    ledgerService.listAdminCredits.mockResolvedValue([
      {
        journalId: 'j1',
        amount: 250,
        reason: 'Thưởng khảo sát',
        createdAt: now,
        reversed: true,
        reversalJournalId: 'rev-j1',
        reversedAt: now,
      },
    ]);

    const result = await controller.listCredits(targetId);

    expect(ledgerService.listAdminCredits).toHaveBeenCalledWith(targetId, 50);
    expect(result.data?.items).toEqual([
      {
        journalId: 'j1',
        amount: 250,
        reason: 'Thưởng khảo sát',
        createdAt: now.toISOString(),
        reversed: true,
        reversalJournalId: 'rev-j1',
        reversedAt: now.toISOString(),
      },
    ]);
  });
});
