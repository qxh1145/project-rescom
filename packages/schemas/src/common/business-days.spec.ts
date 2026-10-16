import { addBusinessDays, businessDaysUntil } from './business-days';

describe('addBusinessDays (UTC+7 business days)', () => {
  it('Mon 10:00 + 3 = Thu 10:00', () => {
    // 2026-10-12 is Monday. 10:00 UTC+7 is 03:00 UTC
    const start = new Date('2026-10-12T03:00:00.000Z');
    const result = addBusinessDays(start, 3);
    // Thu 2026-10-15 10:00 UTC+7 = 03:00 UTC
    expect(result.toISOString()).toBe('2026-10-15T03:00:00.000Z');
  });

  it('Thu 10:00 + 3 = Tue 10:00 (crosses a weekend)', () => {
    // 2026-10-15 is Thursday. 10:00 UTC+7 is 03:00 UTC
    const start = new Date('2026-10-15T03:00:00.000Z');
    const result = addBusinessDays(start, 3);
    // Fri (1), Mon (2), Tue (3) -> 2026-10-20 03:00 UTC
    expect(result.toISOString()).toBe('2026-10-20T03:00:00.000Z');
  });

  it('Fri 23:30 local + 1 = Mon 23:30', () => {
    // 2026-10-16 is Friday. 23:30 UTC+7 is 16:30 UTC
    const start = new Date('2026-10-16T16:30:00.000Z');
    const result = addBusinessDays(start, 1);
    // Mon 2026-10-19 23:30 UTC+7 = 16:30 UTC
    expect(result.toISOString()).toBe('2026-10-19T16:30:00.000Z');
  });

  it('Sat 15:00 + 3 = Thu 00:00 (Sat rolls to Mon 00:00, then +3 business days)', () => {
    // 2026-10-17 is Saturday. 15:00 UTC+7 is 08:00 UTC
    const start = new Date('2026-10-17T08:00:00.000Z');
    const result = addBusinessDays(start, 3);
    // Rolls to Mon 00:00 UTC+7. +3 business days -> Thu 00:00 UTC+7 (Wed 17:00 UTC)
    expect(result.toISOString()).toBe('2026-10-21T17:00:00.000Z');
  });

  it('handles a UTC instant that is already Saturday in UTC+7 (e.g. Fri 18:00Z)', () => {
    // Fri 18:00 UTC is Sat 01:00 UTC+7
    const start = new Date('2026-10-16T18:00:00.000Z');
    const result = addBusinessDays(start, 1);
    // Rolls to Mon 00:00 UTC+7. +1 business day -> Tue 00:00 UTC+7 (Mon 17:00 UTC)
    expect(result.toISOString()).toBe('2026-10-19T17:00:00.000Z');
  });

  it('rejects negative days', () => {
    expect(() => addBusinessDays(new Date(), -1)).toThrow('days must be a non-negative integer');
  });
});

describe('businessDaysUntil', () => {
  it('counts Fri 17:00 to Wed 17:00 as 3', () => {
    expect(businessDaysUntil(new Date('2026-10-16T10:00:00Z'), new Date('2026-10-21T10:00:00Z'))).toBe(3);
  });
  it('rolls weekend start forward and returns zero when overdue', () => {
    expect(businessDaysUntil(new Date('2026-10-17T08:00:00Z'), new Date('2026-10-19T10:00:00Z'))).toBe(1);
    expect(businessDaysUntil(new Date('2026-10-19T10:00:00Z'), new Date('2026-10-17T08:00:00Z'))).toBe(0);
  });
});
