import { InMemoryOAuthIntentRepository } from './in-memory-oauth-intent.repository';
import { CreateOAuthIntentParams } from '../application/ports/oauth-intent-repository.port';

describe('OAuthIntentRepository (Task 3)', () => {
  let repo: InMemoryOAuthIntentRepository;

  beforeEach(() => {
    repo = new InMemoryOAuthIntentRepository();
  });

  const createSampleIntent = (
    overrides?: Partial<CreateOAuthIntentParams>,
  ): CreateOAuthIntentParams => ({
    id: '123e4567-e89b-12d3-a456-426614174000',
    flowType: 'LOGIN',
    targetUserId: null,
    stateDigest: 'state-digest-1',
    nonceDigest: 'nonce-digest-1',
    browserBindingDigest: 'browser-binding-1',
    pkceVerifierEncrypted: 'iv.tag.ciphertext',
    expiresAt: new Date(Date.now() + 600 * 1000),
    consumedAt: null,
    failedAt: null,
    createdAt: new Date(),
    ...overrides,
  });

  it('should store and find intent by id', async () => {
    const intent = createSampleIntent();
    await repo.createIntent(intent);

    const found = await repo.findById(intent.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(intent.id);
    expect(found?.isValid()).toBe(true);
  });

  it('should atomically consume intent exactly once and reject replay', async () => {
    const intent = createSampleIntent();
    await repo.createIntent(intent);

    // First consume succeeds
    const firstConsume = await repo.consumeIntent(intent.id);
    expect(firstConsume).not.toBeNull();
    expect(firstConsume?.isConsumed()).toBe(true);

    // Replay attempt fails
    const secondConsume = await repo.consumeIntent(intent.id);
    expect(secondConsume).toBeNull();
  });

  it('should reject consuming expired intent', async () => {
    const expiredIntent = createSampleIntent({
      expiresAt: new Date(Date.now() - 1000),
    });
    await repo.createIntent(expiredIntent);

    const consumed = await repo.consumeIntent(expiredIntent.id);
    expect(consumed).toBeNull();
  });

  it('should handle concurrent consume attempts race-safely (exactly one winner)', async () => {
    const intent = createSampleIntent({ id: 'concurrent-intent-id' });
    await repo.createIntent(intent);

    const results = await Promise.all([
      repo.consumeIntent(intent.id),
      repo.consumeIntent(intent.id),
    ]);

    const winners = results.filter((r) => r !== null);
    const losers = results.filter((r) => r === null);

    expect(winners.length).toBe(1);
    expect(losers.length).toBe(1);
  });

  it('should bound active intents by invalidating older unconsumed intents for same browser binding or user', async () => {
    const browserBindingDigest = 'browser-hash-abc';
    const firstIntent = createSampleIntent({
      id: 'intent-1',
      browserBindingDigest,
    });
    await repo.createIntent(firstIntent);

    // New intent arrives from same browser
    await repo.invalidatePriorIntents({ browserBindingDigest });
    const secondIntent = createSampleIntent({
      id: 'intent-2',
      browserBindingDigest,
    });
    await repo.createIntent(secondIntent);

    // First intent should be marked failed and cannot be consumed
    const firstAttempt = await repo.consumeIntent('intent-1');
    expect(firstAttempt).toBeNull();

    // Second intent can be consumed
    const secondAttempt = await repo.consumeIntent('intent-2');
    expect(secondAttempt).not.toBeNull();
  });

  it('should clean up expired intents', async () => {
    const past = new Date(Date.now() - 5000);
    const future = new Date(Date.now() + 5000);

    await repo.createIntent(
      createSampleIntent({ id: 'expired-1', expiresAt: past }),
    );
    await repo.createIntent(
      createSampleIntent({ id: 'active-1', expiresAt: future }),
    );

    const deleted = await repo.deleteExpired(new Date());
    expect(deleted).toBe(1);

    expect(await repo.findById('expired-1')).toBeNull();
    expect(await repo.findById('active-1')).not.toBeNull();
  });
});
