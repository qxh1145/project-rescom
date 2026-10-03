import { currentRequestId } from './request-context';
import { requestIdMiddleware } from './request-id.middleware';

function run(inbound?: unknown) {
  const res = { setHeader: jest.fn() };
  let seen: string | undefined;
  requestIdMiddleware(
    { headers: { 'x-request-id': inbound } } as any,
    res as any,
    () => {
      seen = currentRequestId();
    },
  );
  return { header: res.setHeader.mock.calls[0], seen };
}

describe('requestIdMiddleware (IR.5 C1)', () => {
  const uuid = '7d5b0b32-6a43-4d63-9d7e-2f0e8f3a6c11';

  it('honours a well-formed inbound uuid and exposes it to handlers', () => {
    const { header, seen } = run(uuid);
    expect(header).toEqual(['X-Request-Id', uuid]);
    expect(seen).toBe(uuid);
  });

  it.each([['not-a-uuid'], ['x'.repeat(500)], [['a', 'b']], [undefined]])(
    'generates a fresh uuid for %p',
    (inbound) => {
      const { header, seen } = run(inbound);
      expect(header[1]).toMatch(/^[0-9a-f-]{36}$/);
      expect(header[1]).not.toBe(inbound);
      expect(seen).toBe(header[1]);
    },
  );

  it('has no request id outside a request', () => {
    expect(currentRequestId()).toBeUndefined();
  });
});
