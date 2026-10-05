import { AsyncLocalStorage } from 'node:async_hooks';

const requestIds = new AsyncLocalStorage<string>();

/** Story IR.5 C1: the correlation id of the request being handled, if any. */
export function currentRequestId(): string | undefined {
  return requestIds.getStore();
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestIds.run(requestId, fn);
}
