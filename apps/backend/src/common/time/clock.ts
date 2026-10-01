/**
 * Story IR.2b (AC8): the injectable time source. The scheduler, its lease and
 * claim SQL and the ledger's 48h maturity cutoff read `now()` from here, so
 * tests can pin and advance time instead of using fake timers for DB logic.
 */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Test clock: a fixed instant that only moves when told to. */
export class FixedClock implements Clock {
  private current: number;

  constructor(start: Date | number = Date.now()) {
    this.current = typeof start === 'number' ? start : start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date | number): void {
    this.current = typeof instant === 'number' ? instant : instant.getTime();
  }

  advance(ms: number): void {
    this.current += ms;
  }
}
