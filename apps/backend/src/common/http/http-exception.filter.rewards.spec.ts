import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { REDEMPTION_ERROR_HTTP_STATUS } from '@rescom/schemas';
import { HttpExceptionFilter } from './http-exception.filter';
import {
  RedemptionRejectionException,
  ReplayedRedemptionRejectionException,
  RewardsException,
  RewardsErrorCode,
} from '../../modules/rewards/application/exceptions/rewards.exceptions';

describe('Rewards errors', () => {
  const cases: [RewardsErrorCode, number][] = [
    ['REWARDS_ADMIN_CAPABILITY_REQUIRED', HttpStatus.FORBIDDEN],
    ['VOUCHER_NOT_FOUND', HttpStatus.NOT_FOUND],
    ['VOUCHER_ARCHIVED', HttpStatus.CONFLICT],
    ['SHARED_FLAG_LOCKED', HttpStatus.CONFLICT],
    ['SHARED_CODE_VOUCHER', HttpStatus.CONFLICT],
    ['STOCK_BELOW_COMMITTED', HttpStatus.CONFLICT],
    ['STOCK_INCREASE_NEEDS_CODES', HttpStatus.CONFLICT],
    ['STOCK_EXCEEDS_CODES', HttpStatus.CONFLICT],
    // Story 12.8: errors outside the closed redemptionErrorSchema union.
    ['QUOTE_NOT_FOUND', HttpStatus.NOT_FOUND],
    ['REDEMPTION_NOT_FOUND', HttpStatus.NOT_FOUND],
    ['QUOTE_ALREADY_REDEEMED', HttpStatus.CONFLICT],
    ['IDEMPOTENCY_KEY_CONFLICT', HttpStatus.CONFLICT],
  ];
  it.each(cases)(
    '%s maps to %s and preserves details',
    (code, expectedStatus) => {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status, headersSent: false }),
          getRequest: () => ({}),
        }),
      } as unknown as ArgumentsHost;
      new HttpExceptionFilter().catch(
        new RewardsException(code, 'message', { minimum: 5 }),
        host,
      );
      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(json).toHaveBeenCalledWith({
        data: null,
        error: { code, message: 'message', details: { minimum: 5 } },
        meta: {},
      });
    },
  );

  it.each([
    ['BRAND_NOT_FOUND', 'brandId'],
    ['REDEMPTION_WINDOW_ENDED', 'redeemEndsAt'],
    ['SHARED_CODE_REQUIRED', 'sharedCode'],
  ] as [RewardsErrorCode, string][])(
    '%s maps to 400 VALIDATION_ERROR with field details',
    (code, path) => {
      const json = jest.fn();
      const status = jest.fn().mockReturnValue({ json });
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status, headersSent: false }),
          getRequest: () => ({}),
        }),
      } as unknown as ArgumentsHost;
      new HttpExceptionFilter().catch(
        new RewardsException(code, code, { path }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(json).toHaveBeenCalledWith({
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: [{ path, code }],
        },
        meta: {},
      });
    },
  );

  it.each(
    Object.entries(REDEMPTION_ERROR_HTTP_STATUS) as [
      RedemptionRejectionException['code'],
      number,
    ][],
  )(
    'redemption rejection %s uses REDEMPTION_ERROR_HTTP_STATUS (%s)',
    (code, expectedStatus) => {
      for (const Ctor of [
        RedemptionRejectionException,
        ReplayedRedemptionRejectionException,
      ]) {
        const json = jest.fn();
        const status = jest.fn().mockReturnValue({ json });
        const host = {
          switchToHttp: () => ({
            getResponse: () => ({ status, headersSent: false }),
            getRequest: () => ({}),
          }),
        } as unknown as ArgumentsHost;
        const error =
          Ctor === RedemptionRejectionException
            ? new RedemptionRejectionException(code, 'm', { voucherId: 'v' })
            : new ReplayedRedemptionRejectionException(code, {
                voucherId: 'v',
              });
        new HttpExceptionFilter().catch(error, host);
        expect(status).toHaveBeenCalledWith(expectedStatus);
        expect(json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: expect.objectContaining({
              code,
              details: { voucherId: 'v' },
            }),
          }),
        );
      }
    },
  );
});
