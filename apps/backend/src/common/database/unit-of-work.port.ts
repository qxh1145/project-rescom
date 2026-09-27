export const UNIT_OF_WORK_PORT = Symbol('UNIT_OF_WORK_PORT');

/**
 * Shared Unit of Work for cross-context workflows that must be all-or-nothing
 * before reply (AD-16). Owners keep writing only their own tables; the
 * coordinator only decides the atomic boundary.
 */
export interface UnitOfWorkPort {
  /**
   * Runs `work` under one shared transaction. `key` is the stable workflow
   * identity (for example `external-completion:${attemptId}`).
   */
  run<T>(key: string, work: () => Promise<T>): Promise<T>;
}

/**
 * Runs work without a database transaction. Used by in-memory adapters and
 * unit tests where every repository call is already synchronous in memory.
 */
export class PassThroughUnitOfWork implements UnitOfWorkPort {
  readonly keys: string[] = [];

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    this.keys.push(key);
    return work();
  }
}
