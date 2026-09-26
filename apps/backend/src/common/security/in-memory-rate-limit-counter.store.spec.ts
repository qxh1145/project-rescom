import { InMemoryRateLimitCounterStore } from './in-memory-rate-limit-counter.store';

describe('InMemoryRateLimitCounterStore (Story 8.2)', () => {
  const t0 = new Date('2026-09-26T10:00:00.000Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it('counts hits inside one fixed window anchored at the first hit', async () => {
    const store = new InMemoryRateLimitCounterStore();

    const first = await store.increment('user-1:start', 60_000, t0);
    const second = await store.increment('user-1:start', 60_000, at(59_999));

    expect(first).toEqual({
      hits: 1,
      windowStartedAt: t0,
      resetAt: at(60_000),
    });
    expect(second.hits).toBe(2);
    expect(second.windowStartedAt).toEqual(t0);
  });

  it('starts a new window once the previous one expired', async () => {
    const store = new InMemoryRateLimitCounterStore();
    await store.increment('user-1:start', 60_000, t0);
    await store.increment('user-1:start', 60_000, at(1_000));

    const next = await store.increment('user-1:start', 60_000, at(60_000));

    expect(next).toEqual({
      hits: 1,
      windowStartedAt: at(60_000),
      resetAt: at(120_000),
    });
  });

  it('keeps keys independent (per user, per action)', async () => {
    const store = new InMemoryRateLimitCounterStore();
    await store.increment('user-1:start', 60_000, t0);
    await store.increment('user-1:start', 60_000, t0);

    expect((await store.increment('user-2:start', 60_000, t0)).hits).toBe(1);
    expect((await store.increment('user-1:submit', 60_000, t0)).hits).toBe(1);
  });

  it('evicts expired windows so memory stays bounded', async () => {
    const store = new InMemoryRateLimitCounterStore({ maxEntries: 3 });
    await store.increment('a', 1_000, t0);
    await store.increment('b', 1_000, t0);
    await store.increment('c', 1_000, t0);

    await store.increment('d', 1_000, at(5_000));

    expect(store.size).toBe(1);
  });

  it('enforces maxEntries with live windows by evicting the oldest one (Epic 8 review P10)', async () => {
    const store = new InMemoryRateLimitCounterStore({ maxEntries: 3 });
    await store.increment('a', 60_000, t0);
    await store.increment('b', 60_000, t0);
    await store.increment('c', 60_000, t0);

    await store.increment('d', 60_000, at(1_000));

    expect(store.size).toBe(3);
    // 'a' was the oldest: it starts over; the others keep their counters.
    expect((await store.increment('b', 60_000, at(2_000))).hits).toBe(2);
    expect(store.size).toBe(3);
    expect((await store.increment('a', 60_000, at(2_000))).hits).toBe(1);
    expect(store.size).toBe(3);
  });

  it('moves a restarted window to the back of the eviction order', async () => {
    const store = new InMemoryRateLimitCounterStore({ maxEntries: 2 });
    await store.increment('a', 1_000, t0);
    await store.increment('b', 60_000, t0);
    // 'a' expires and restarts: now 'b' is the oldest window.
    await store.increment('a', 60_000, at(2_000));

    await store.increment('c', 60_000, at(3_000));

    expect(store.size).toBe(2);
    expect((await store.increment('a', 60_000, at(4_000))).hits).toBe(2);
  });

  it('does not rescan the whole map before the earliest window can expire', async () => {
    const store = new InMemoryRateLimitCounterStore({ maxEntries: 3 });
    const scan = jest.spyOn(store as any, 'evictExpired');
    await store.increment('a', 60_000, t0);
    await store.increment('b', 60_000, t0);
    await store.increment('c', 60_000, t0);

    for (let i = 0; i < 50; i++) {
      await store.increment(`live-${i}`, 60_000, at(1_000 + i));
    }
    expect(scan).not.toHaveBeenCalled();
    expect(store.size).toBe(3);

    // Once a window can have expired, one scan frees the expired ones.
    await store.increment('late', 60_000, at(62_000));
    expect(scan).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });
});
