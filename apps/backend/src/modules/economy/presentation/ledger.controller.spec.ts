import { LedgerController } from './ledger.controller';
import { LedgerService } from '../application/ledger.service';
import { InMemoryLedgerRepository } from '../infrastructure/in-memory-ledger.repository';
import { AuthenticatedUser } from '../../auth/presentation/types/authenticated-request.type';

describe('LedgerController', () => {
  let controller: LedgerController;
  let service: LedgerService;
  let repo: InMemoryLedgerRepository;

  const mockUser: AuthenticatedUser = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'user@example.com',
    role: 'RESPONDENT',
    status: 'ACTIVE',
  };

  beforeEach(() => {
    repo = new InMemoryLedgerRepository();
    service = new LedgerService(repo);
    controller = new LedgerController(service);
  });

  it('posts a journal via endpoint and returns standard success envelope', async () => {
    const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const userAcc = await service.getOrCreateAccount(mockUser.id, 'USER_AVAILABLE');

    const res = await controller.postJournal({
      idempotencyKey: 'ctrl-tx-1',
      description: 'Test issuance',
      entries: [
        { accountId: sys.id, amount: -100 },
        { accountId: userAcc.id, amount: 100 },
      ],
    });

    expect(res.data).toBeDefined();
    expect(res.data?.idempotencyKey).toBe('ctrl-tx-1');
    expect(res.data?.entries).toHaveLength(2);
    expect(res.error).toBeNull();
  });

  it('reverses a journal via endpoint and returns standard success envelope', async () => {
    const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const userAcc = await service.getOrCreateAccount(mockUser.id, 'USER_AVAILABLE');

    const postRes = await controller.postJournal({
      idempotencyKey: 'ctrl-tx-rev',
      entries: [
        { accountId: sys.id, amount: -200 },
        { accountId: userAcc.id, amount: 200 },
      ],
    });

    const revRes = await controller.reverseJournal(postRes.data!.id, {
      reason: 'Reversal test',
    });

    expect(revRes.data?.reversesJournalId).toBe(postRes.data!.id);
    expect(revRes.data?.entries).toHaveLength(2);
    expect(revRes.error).toBeNull();
  });

  it('gets my accounts for current user', async () => {
    await service.getOrCreateAccount(mockUser.id, 'USER_AVAILABLE');
    await service.getOrCreateAccount(mockUser.id, 'FROZEN');

    const res = await controller.getMyAccounts(mockUser);
    expect(res.data).toHaveLength(2);
    expect(res.error).toBeNull();
  });

  it('verifies balance and audits ledger integrity', async () => {
    const sys = await service.getOrCreateAccount(null, 'SYSTEM_ISSUANCE');
    const userAcc = await service.getOrCreateAccount(mockUser.id, 'USER_AVAILABLE');

    await service.transfer({
      fromAccountId: sys.id,
      toAccountId: userAcc.id,
      amount: 100,
      idempotencyKey: 'tx-audit',
    });

    const balanceRes = await controller.getAccountBalance(userAcc.id);
    expect(balanceRes.data?.projectedBalance).toBe(100);
    expect(balanceRes.data?.isConsistent).toBe(true);

    const integrityRes = await controller.verifyLedgerIntegrity();
    expect(integrityRes.data?.isZeroSum).toBe(true);
    expect(integrityRes.data?.totalSystemBalance).toBe(0);
  });
});
