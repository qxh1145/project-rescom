import { InMemoryUserRepository } from './in-memory-user.repository';
import { PrismaUserRepository } from './prisma-user.repository';
import { EmailAlreadyRegisteredException } from '../../auth/application/exceptions/auth.exceptions';

describe('UserRepository (Task 3 Integration)', () => {
  let repository: InMemoryUserRepository;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
  });

  it('should find user by normalized email regardless of input casing/whitespace', async () => {
    await repository.create({
      email: 'user@example.com',
      passwordHash: '$2a$12$somehash',
    });

    const found = await repository.findByEmail('  USER@example.COM  ');
    expect(found).not.toBeNull();
    expect(found?.email).toBe('user@example.com');
    expect(found?.role).toBe('RESPONDENT');
    expect(found?.status).toBe('ACTIVE');
  });

  it('should create user with explicit and default properties', async () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    const user = await repository.create({
      id,
      email: 'test@example.com',
      passwordHash: '$2a$12$hashed',
      role: 'RESPONDENT',
      status: 'ACTIVE',
    });

    expect(user.id).toBe(id);
    expect(user.email).toBe('test@example.com');
    expect(user.passwordHash).toBe('$2a$12$hashed');
    expect(user.role).toBe('RESPONDENT');
    expect(user.status).toBe('ACTIVE');
  });

  it('should prevent duplicate registration and handle concurrent creations safely', async () => {
    const registration1 = repository.create({
      email: 'concurrent@example.com',
      passwordHash: '$2a$12$hash1',
    });

    const registration2 = repository.create({
      email: 'concurrent@example.com',
      passwordHash: '$2a$12$hash2',
    });

    const results = await Promise.allSettled([registration1, registration2]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly one must succeed and one must fail
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (rejected[0].status === 'rejected') {
      expect((rejected[0].reason as any).code).toBe(
        'AUTH_EMAIL_ALREADY_REGISTERED',
      );
    }
  });

  it('should support nullable passwordHash for future identity providers', async () => {
    const user = await repository.create({
      email: 'oauth@example.com',
      passwordHash: null,
    });

    expect(user.passwordHash).toBeNull();
    expect(user.hasPassword()).toBe(false);
  });
});

describe('PrismaUserRepository (P2002 mapping)', () => {
  it('should map Prisma P2002 error to EmailAlreadyRegisteredException', async () => {
    const mockPrisma: any = {
      user: {
        create: jest.fn().mockRejectedValue({ code: 'P2002' }),
      },
    };
    const repo = new PrismaUserRepository(mockPrisma);

    await expect(
      repo.create({
        email: 'duplicate@example.com',
        passwordHash: '$2a$12$hash',
      }),
    ).rejects.toThrow(EmailAlreadyRegisteredException);
  });
});
