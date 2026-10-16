import { probePreflight, webhookUrlFor } from './payos-probe-preflight';

const ready = {
  credentials: {
    PAYOS_CLIENT_ID: 'id',
    PAYOS_API_KEY: 'api',
    PAYOS_CHECKSUM_KEY: 'checksum',
  },
  payosEnabled: false,
  probeEmail: 'owner@example.com',
};

describe('payOS probe preflight', () => {
  it.each(['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY'])(
    'names missing %s',
    (key) => {
      expect(
        probePreflight({
          ...ready,
          credentials: { ...ready.credentials, [key]: '' },
        }),
      ).toEqual([`${key} is missing`]);
    },
  );
  it('rejects enabled checkout', () => {
    expect(probePreflight({ ...ready, payosEnabled: true })).toEqual([
      expect.stringContaining('PAYOS_ENABLED=true'),
    ]);
  });
  it('rejects absent email', () => {
    expect(probePreflight({ ...ready, probeEmail: ' ' })).toEqual([
      'PROBE_USER_EMAIL is missing',
    ]);
  });
  it('reports every refusal together', () => {
    expect(
      probePreflight({ credentials: {}, payosEnabled: true }),
    ).toHaveLength(5);
  });
  it('accepts complete settings', () => {
    expect(probePreflight(ready)).toEqual([]);
  });
  it.each(['https://app.rescom.io.vn', 'https://app.rescom.io.vn/'])(
    'builds URL from %s',
    (base) => {
      expect(webhookUrlFor(base)).toBe(
        'https://app.rescom.io.vn/api/economy/top-ups/payos/webhook',
      );
    },
  );
});
