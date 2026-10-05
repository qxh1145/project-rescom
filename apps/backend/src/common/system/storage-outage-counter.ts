/**
 * Story IR.5 C3: process-wide count of storage / scanner outages since boot,
 * exposed by `GET /system/metrics` (`storage.outagesSinceBoot`). A plain
 * counter: one API replica per AD-23; Story 11.4 wires alerting to it.
 */
let outages = 0;

export function recordStorageOutage(): void {
  outages += 1;
}

export function storageOutagesSinceBoot(): number {
  return outages;
}
