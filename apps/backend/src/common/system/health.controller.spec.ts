import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let prisma: { $queryRaw: jest.Mock };
  let scanner: { ping: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    scanner = { ping: jest.fn().mockResolvedValue(true) };
    controller = new HealthController(prisma as any, scanner as any);
  });

  it('live returns ok without I/O', () => {
    expect(controller.live().data).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(scanner.ping).not.toHaveBeenCalled();
  });

  it('ready returns 200 data when database and scanner are up', async () => {
    const res = await controller.ready();
    expect(res.data).toEqual({
      status: 'ready',
      checks: { database: 'up', scanner: 'up', scheduler: 'disabled' },
    });
  });

  it('reports the scheduler status informationally', async () => {
    const schedulerHealth = {
      cachedSnapshot: jest.fn().mockResolvedValue({ status: 'degraded' }),
    };
    controller = new HealthController(
      prisma as any,
      scanner as any,
      schedulerHealth as any,
    );
    const res = await controller.ready();
    expect(res.data?.checks.scheduler).toBe('degraded');
  });

  async function rejection(): Promise<ServiceUnavailableException> {
    try {
      await controller.ready();
    } catch (error) {
      return error as ServiceUnavailableException;
    }
    throw new Error('expected ready() to throw');
  }

  it('database down gives 503 with checks and no error text', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED db.internal:5432 password=secret'),
    );
    const error = await rejection();
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual({
      code: 'NOT_READY',
      message: 'Service is not ready.',
      details: { database: 'down', scanner: 'up', scheduler: 'disabled' },
    });
    expect(JSON.stringify(error.getResponse())).not.toMatch(
      /ECONNREFUSED|db\.internal|secret/,
    );
  });

  it('scanner down gives 503 with checks', async () => {
    scanner.ping.mockResolvedValue(false);
    const error = await rejection();
    expect(error.getStatus()).toBe(503);
    expect((error.getResponse() as any).details).toEqual({
      database: 'up',
      scanner: 'down',
      scheduler: 'disabled',
    });
  });

  it('a hanging check times out as down', async () => {
    jest.useFakeTimers();
    try {
      scanner.ping.mockReturnValue(new Promise(() => undefined));
      const pending = rejection();
      await jest.advanceTimersByTimeAsync(2100);
      expect((await pending).getStatus()).toBe(503);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a second call inside the cache window does not re-query', async () => {
    await controller.ready();
    await controller.ready();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(scanner.ping).toHaveBeenCalledTimes(1);
  });
});
