import { Logger } from '@nestjs/common';
import { PayosEnableGuard } from './payos-enable-guard';
import { PayosAvailability } from '../application/payos-availability';
import { EnvService } from '../../../common/config/env.service';
import { PayosTopUpRepositoryPort } from '../application/ports/payos-top-up-repository.port';
import { AdminCapabilityPort } from '../application/ports/admin-capability.port';
import { NotificationPublisherPort } from '../../notifications/application/ports/notification-publisher.port';

describe('PayosEnableGuard', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-15T23:59:59.000Z') });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stays off with flag false, opens with zero pending, blocks and alerts admins with pending', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const availability = new PayosAvailability();
    const countManualPending = jest.fn().mockResolvedValue(0);
    const listActiveAdminIds = jest.fn().mockResolvedValue(['admin', 'admin2']);
    const publish = jest
      .fn()
      .mockRejectedValueOnce(new Error('publish down'))
      .mockResolvedValue(undefined);
    const guard = (enabled: boolean) =>
      new PayosEnableGuard(
        { payosEnabled: enabled } as EnvService,
        availability,
        { countManualPending } as unknown as PayosTopUpRepositoryPort,
        { listActiveAdminIds } as unknown as AdminCapabilityPort,
        { publish } as unknown as NotificationPublisherPort,
      );
    await guard(false).onApplicationBootstrap();
    expect(countManualPending).not.toHaveBeenCalled();
    countManualPending.mockResolvedValueOnce(4);
    await guard(true).onApplicationBootstrap();
    expect(availability.isCheckoutOpen()).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('4 manual PENDING'),
    );
    // first admin's publish fails; the second admin is still alerted
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'WARNING',
        userId: 'admin2',
        dedupeKey: 'payos-enable-blocked:2026-10-15',
      }),
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('alert to admin admin failed: publish down'),
    );
    error.mockClear();
    await guard(true).onApplicationBootstrap();
    expect(availability.isCheckoutOpen()).toBe(true);
    expect(error).not.toHaveBeenCalled();
    const brokenAvailability = new PayosAvailability();
    countManualPending.mockRejectedValueOnce(new Error('database unavailable'));
    await new PayosEnableGuard(
      { payosEnabled: true } as EnvService,
      brokenAvailability,
      { countManualPending } as unknown as PayosTopUpRepositoryPort,
      { listActiveAdminIds } as unknown as AdminCapabilityPort,
    ).onApplicationBootstrap();
    expect(brokenAvailability.isCheckoutOpen()).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('checkout stays off: database unavailable'),
    );
  });
});
